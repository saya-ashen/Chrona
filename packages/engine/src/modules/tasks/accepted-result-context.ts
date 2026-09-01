import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

const RESULT_CONTEXT_LIMIT = 12_000;
const RESULT_VALUE_LIMIT = 2_000;
const TABLE_ROW_LIMIT = 25;

export type AcceptedResultContext = {
  task: {
    id: string;
    workspaceId: string;
    title: string;
    goalId: string | null;
    priority: "Low" | "Medium" | "High" | "Urgent";
    executionConfig: Record<string, unknown>;
    aiClientId: string | null;
  };
  acceptance: {
    runId: string;
    acceptedAt: string;
    taskSessionId: string | null;
    providerSessionRef: string | null;
  };
  summary: string;
  spec: unknown | null;
  artifacts: Array<{
    id: string;
    title: string;
    type: string;
    uri: string | null;
  }>;
};

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function bounded(value: string, limit = RESULT_VALUE_LIMIT) {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsedTableRows(content: string): unknown[] {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const record = recordValue(parsed);
    const rows = record?.rows ?? record?.items ?? record?.data;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function tableText(props: Record<string, unknown>) {
  const columns = Array.isArray(props.columns) ? props.columns : [];
  const rowsSource = Array.isArray(props.rows)
    ? props.rows
    : typeof props.contentPreview === "string"
      ? parsedTableRows(props.contentPreview)
      : [];
  const rows = rowsSource.slice(0, TABLE_ROW_LIMIT);
  const labels = columns
    .map((column) => {
      const record = recordValue(column);
      return record ? textValue(record.label ?? record.header ?? record.key) : "";
    })
    .filter(Boolean);
  const body = rows
    .map((row) => {
      const record = recordValue(row);
      if (!record) return "";
      return Object.values(record).map(textValue).filter(Boolean).join(" | ");
    })
    .filter(Boolean);
  return [labels.join(" | "), ...body].filter(Boolean).join("\n");
}

function actionPlanText(props: Record<string, unknown>) {
  const phases = Array.isArray(props.phases) ? props.phases : [];
  return phases
    .map((value) => {
      const phase = recordValue(value);
      if (!phase) return "";
      const actions = Array.isArray(phase.actions)
        ? phase.actions.map(textValue).filter(Boolean)
        : [];
      return [phase.title, phase.timeframe, ...actions]
        .map(textValue)
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

export function extractAcceptedResultText(spec: unknown) {
  const document = recordValue(spec);
  const elements = recordValue(document?.elements);
  if (!elements) return "No structured result content was available.";

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const rawElement of Object.values(elements)) {
    const element = recordValue(rawElement);
    if (!element || element.visible === false) continue;
    const type = textValue(element.type);
    const props = recordValue(element.props) ?? {};
    let text: string;
    switch (type) {
      case "ResultSummary":
        text = [
          props.text,
          props.copyText,
          props.title,
          props.summary,
          props.description,
          props.outcome,
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "ResultHero":
        text = [
          props.title,
          props.summary,
          props.readinessSummary,
          ...(Array.isArray(props.metrics)
            ? props.metrics.map((value) => {
                const metric = recordValue(value);
                return metric
                  ? [metric.label, metric.value].map(textValue).filter(Boolean).join(": ")
                  : "";
              })
            : []),
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "ResultDeliverable":
        text = [
          props.title,
          props.summary,
          props.formatLabel,
          props.displayPath ?? props.path,
          props.contentPreview,
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "ResultInsight":
        text = [
          props.title,
          props.summary,
          ...(Array.isArray(props.points) ? props.points : []),
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "ResultActionPlan":
        text = [props.title, props.summary, actionPlanText(props)]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "ResultCaveats":
      case "ResultEvidence":
        text = [
          props.title,
          props.summary,
          ...(Array.isArray(props.items) ? props.items : []),
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "Markdown":
        text = textValue(props.content);
        break;
      case "Text":
        text = textValue(props.text ?? props.content);
        break;
      case "Heading":
        text = textValue(props.text ?? props.content ?? props.title);
        break;
      case "Alert":
        text = [props.title, props.description, props.message]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "Table":
        text = [
          props.title,
          props.description,
          tableText(props),
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "FileRef":
      case "FileView":
        text = [
          props.title,
          props.description,
          props.displayPath ?? props.uri ?? props.path,
          props.contentPreview,
        ]
          .map(textValue)
          .filter(Boolean)
          .join("\n");
        break;
      case "JsonView":
        text = bounded(textValue(props.content ?? props.value), 1_000);
        break;
      default:
        continue;
    }
    const normalized = bounded(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    parts.push(normalized);
    if (parts.join("\n\n").length >= RESULT_CONTEXT_LIMIT) break;
  }

  const result = parts.join("\n\n");
  return result
    ? bounded(result, RESULT_CONTEXT_LIMIT)
    : "No readable structured result content was available.";
}

function acceptedRunIdFromPayload(payload: unknown) {
  const record = recordValue(payload);
  return textValue(record?.accepted_run_id) || null;
}

export async function getAcceptedResultContext(
  taskId: string,
): Promise<AcceptedResultContext> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      goalId: true,
      priority: true,
      executionConfig: true,
      aiClientId: true,
    },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }

  const acceptance = await db.event.findFirst({
    where: { taskId, eventType: "task.result_accepted" },
    orderBy: [{ ingestSequence: "desc" }, { createdAt: "desc" }],
    select: { payload: true, runId: true, occurredAt: true, createdAt: true },
  });
  const acceptedRunId =
    acceptedRunIdFromPayload(acceptance?.payload) ?? acceptance?.runId ?? null;
  if (!acceptance || !acceptedRunId) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Accepted result record is missing",
    );
  }

  const run = await db.run.findFirst({
    where: { id: acceptedRunId, taskId, status: "Completed" },
    select: {
      id: true,
      taskSessionId: true,
      runtimeSessionRef: true,
      taskSession: { select: { providerSessionRef: true } },
      events: {
        where: { planId: { not: null } },
        orderBy: { ingestSequence: "desc" },
        take: 1,
        select: { planId: true },
      },
      artifacts: {
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, type: true, uri: true },
      },
    },
  });
  if (!run) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Accepted run is unavailable",
    );
  }

  const acceptedPlanId = run.events[0]?.planId ?? null;
  const acceptedPlanRun = acceptedPlanId
    ? await db.taskPlanRun.findFirst({
        where: { taskId, planId: acceptedPlanId },
        orderBy: { updatedAt: "desc" },
        select: { planRun: true },
      })
    : null;
  const persisted = recordValue(acceptedPlanRun?.planRun);
  const mutableGraph = recordValue(persisted?.mutableGraph);
  const planOutput = recordValue(mutableGraph?.planOutput);
  const finalizedResult = recordValue(planOutput?.finalizedResult);
  const spec = finalizedResult?.spec ?? null;

  return {
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      goalId: task.goalId,
      priority: task.priority,
      executionConfig: task.executionConfig as Record<string, unknown>,
      aiClientId: task.aiClientId,
    },
    acceptance: {
      runId: run.id,
      acceptedAt: (acceptance.occurredAt ?? acceptance.createdAt).toISOString(),
      taskSessionId: run.taskSessionId,
      providerSessionRef:
        run.taskSession?.providerSessionRef ?? run.runtimeSessionRef ?? null,
    },
    summary: extractAcceptedResultText(spec),
    spec,
    artifacts: run.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
    })),
  };
}

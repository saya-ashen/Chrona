import { db } from "@/lib/db";
import { isTaskPlanGenerationRunning } from "@/modules/plans/task-plan-generation-registry";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { reconcileTaskState } from "@/modules/orchestration/reconcile-task-state";
import {
  getRuntimeTaskConfigSpec,
  listExecutionRuntimes,
} from "@/modules/task-execution/registry";
import { deriveTaskRunnability } from "@chrona/shared";

type TaskPlanGenerationStatus =
  | "idle"
  | "generating"
  | "waiting_acceptance"
  | "accepted";

type WorkspaceActivityTimelineItem = {
  id: string;
  kind: "assistant_message" | "reasoning" | "tool_started" | "tool_completed" | "provider_run" | "approval" | "node" | "task" | "artifact" | "schedule" | "raw";
  title: string;
  summary: string;
  description: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  timestamp?: string | null;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  provider?: string;
  runtimeName?: string;
  runId?: string;
  nativeRunId?: string;
  sequence?: number;
  rawEventType?: string;
  tool?: {
    name?: string;
    label?: string;
    preview?: string;
    inputSummary?: string;
    durationMs?: number;
    error?: string;
    state: "started" | "completed" | "failed";
  };
  assistant?: {
    text: string;
    isReasoning: boolean;
    isPartial?: boolean;
  };
  raw?: unknown;
};

type TaskActivityEvent = {
  id: string;
  eventType: string;
  source: string;
  nodeId: string | null;
  nodeTitle: string | null;
  payload: unknown;
  occurredAt: Date | null;
  createdAt: Date;
  ingestSequence?: number | bigint | null;
};

type TaskTimelineActivityItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  severity: string | null;
  status: string | null;
  nodeId: string | null;
  sortTime: Date;
  metadata: unknown;
};

type ActivityCursor = {
  source: "timeline" | "event";
  timestamp: Date;
};

type TaskActivityPageInput = {
  taskId: string;
  scope?: "task" | "node";
  nodeId?: string;
  cursor?: string;
  limit?: number;
};

function readBlockReason(task: {
  blockReason: unknown;
  projection: {
      blockType: string | null;
      actionRequired: string | null;
      blockScope: string | null;
      blockSince: Date | null;
      currentNodeId: string | null;
    } | null;
  }) {
  const storedBlockReason = task.blockReason as {
    blockType?: string;
    actionRequired?: string;
    scope?: string;
    nodeId?: string;
    since?: string;
  } | null;
  const projectedBlockReason = task.projection
    ? {
        blockType: task.projection.blockType ?? undefined,
        actionRequired: task.projection.actionRequired ?? undefined,
        scope: task.projection.blockScope ?? undefined,
        nodeId: task.projection.currentNodeId ?? undefined,
        since: task.projection.blockSince?.toISOString(),
      }
    : null;

  if (storedBlockReason) {
    return {
      ...storedBlockReason,
      nodeId: storedBlockReason.nodeId ?? projectedBlockReason?.nodeId,
      since: storedBlockReason.since ?? projectedBlockReason?.since,
    };
  }

  return projectedBlockReason;
}

function stringPayloadValue(payload: unknown, key: string) {
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>)[key] === "string"
    ? (payload as Record<string, string>)[key]
    : null;
}

function runtimePayloadEvent(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const event = (payload as { event?: unknown }).event;
  return event && typeof event === "object" && !Array.isArray(event) ? event as Record<string, unknown> : null;
}

function arrayPayloadValue(payload: unknown, key: string) {
  return payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray((payload as Record<string, unknown>)[key])
    ? (payload as Record<string, unknown[]>)[key]
    : null;
}

function numberPayloadValue(payload: unknown, key: string) {
  return payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>)[key] === "number"
    ? (payload as Record<string, number>)[key]
    : null;
}

function compactParts(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part?.trim())).join(" · ");
}

function humanizeEventType(eventType: string) {
  return eventType
    .replace(/^[^.]+\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function providerActivityDescription(event: Record<string, unknown>, fallback: string) {
  if (typeof event.text === "string" && event.text.trim()) return event.text.trim();
  if (typeof event.toolName === "string" && event.toolName.trim()) return event.toolName.trim();
  if (typeof event.tool === "string" && event.tool.trim()) return event.tool.trim();
  if (typeof event.error === "string" && event.error.trim()) return event.error.trim();
  const error = event.error;
  if (error && typeof error === "object" && !Array.isArray(error) && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  if (typeof event.rawEventType === "string" && event.rawEventType.trim()) return event.rawEventType.trim();
  return fallback;
}

function providerActivityToolLabel(event: Record<string, unknown>, fallback: string) {
  if (typeof event.label === "string" && event.label.trim()) return event.label.trim();
  if (typeof event.toolName === "string" && event.toolName.trim()) return event.toolName.trim();
  if (typeof event.tool === "string" && event.tool.trim()) return event.tool.trim();
  return fallback;
}

function providerActivityError(event: Record<string, unknown>) {
  if (typeof event.error === "string" && event.error.trim()) return event.error.trim();
  const error = event.error;
  if (error && typeof error === "object" && !Array.isArray(error) && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return undefined;
}

function optionalStringEventValue(event: Record<string, unknown>, key: string) {
  return typeof event[key] === "string" && event[key].trim() ? event[key] as string : undefined;
}

function optionalNumberEventValue(event: Record<string, unknown>, key: string) {
  return typeof event[key] === "number" ? event[key] as number : undefined;
}

function providerActivityText(event: Record<string, unknown>) {
  return typeof event.text === "string" ? event.text : null;
}

function providerActivityEventType(event: TaskActivityEvent, payloadEvent: Record<string, unknown> | null) {
  return payloadEvent && typeof payloadEvent.type === "string"
    ? payloadEvent.type
    : event.eventType.replace(/^provider\./, "");
}

function providerActivityMergeKey(event: TaskActivityEvent, eventType: string) {
  return [
    eventType,
    stringPayloadValue(event.payload, "runtimeName") ?? "runtime",
    stringPayloadValue(event.payload, "provider") ?? "provider",
    stringPayloadValue(event.payload, "runId") ?? "run",
    stringPayloadValue(event.payload, "nativeRunId") ?? "native",
    event.nodeId ?? "task",
  ].join(":");
}

function isMergeableProviderTextEvent(eventType: string) {
  return eventType === "text_delta" || eventType === "reasoning_delta";
}

function mapProviderEventToActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem {
  const payloadEvent = runtimePayloadEvent(event.payload);
  const provider = stringPayloadValue(event.payload, "provider") ?? stringPayloadValue(event.payload, "runtimeName") ?? "provider";
  const runtimeName = stringPayloadValue(event.payload, "runtimeName") ?? undefined;
  const runId = stringPayloadValue(event.payload, "runId") ?? undefined;
  const nativeRunId = stringPayloadValue(event.payload, "nativeRunId") ?? undefined;
  const sequence = numberPayloadValue(event.payload, "sequence") ?? undefined;
  const eventType = providerActivityEventType(event, payloadEvent);
  const timestamp = (event.occurredAt ?? event.createdAt).toISOString();
  const payloadRecord = payloadEvent ?? {};
  const rawEventType = optionalStringEventValue(payloadRecord, "rawEventType") ?? eventType;
  const withBase = (item: WorkspaceActivityTimelineItem): WorkspaceActivityTimelineItem => ({
    ...item,
    provider,
    runtimeName,
    runId,
    nativeRunId,
    sequence,
    rawEventType,
    raw: payloadEvent ?? event.payload,
    ...(event.nodeId ? { sourceNodeId: event.nodeId } : {}),
    ...(event.nodeTitle ? { sourceNodeTitle: event.nodeTitle } : {}),
  });

  switch (eventType) {
    case "run_started":
      return withBase({ id: event.id, kind: "provider_run", title: "Provider run started", summary: provider, description: provider, tone: "info", timestamp });
    case "text_delta":
      return withBase({ id: event.id, kind: "assistant_message", title: "Assistant response", summary: providerActivityDescription(payloadRecord, "Assistant output streamed."), description: providerActivityDescription(payloadRecord, "Assistant output streamed."), tone: "info", timestamp, assistant: { text: providerActivityDescription(payloadRecord, ""), isReasoning: false, isPartial: true } });
    case "reasoning_delta":
      return withBase({ id: event.id, kind: "reasoning", title: "Reasoning", summary: providerActivityDescription(payloadRecord, "Reasoning streamed."), description: providerActivityDescription(payloadRecord, "Reasoning streamed."), tone: "neutral", timestamp, assistant: { text: providerActivityDescription(payloadRecord, ""), isReasoning: true, isPartial: true } });
    case "tool_call":
    case "tool_started":
      return withBase({ id: event.id, kind: "tool_started", title: "Tool started", summary: providerActivityDescription(payloadRecord, "Provider tool started."), description: providerActivityDescription(payloadRecord, "Provider tool started."), tone: "info", timestamp, tool: { name: optionalStringEventValue(payloadRecord, "toolName") ?? optionalStringEventValue(payloadRecord, "tool"), label: providerActivityToolLabel(payloadRecord, "Provider tool"), preview: optionalStringEventValue(payloadRecord, "preview"), inputSummary: optionalStringEventValue(payloadRecord, "inputSummary"), state: "started" } });
    case "tool_result":
    case "tool_completed": {
      const error = providerActivityError(payloadRecord);
      const hasError = Boolean(error);
      return withBase({ id: event.id, kind: "tool_completed", title: hasError ? "Tool failed" : "Tool completed", summary: providerActivityDescription(payloadRecord, "Provider tool completed."), description: providerActivityDescription(payloadRecord, "Provider tool completed."), tone: hasError ? "danger" : "success", timestamp, tool: { name: optionalStringEventValue(payloadRecord, "toolName") ?? optionalStringEventValue(payloadRecord, "tool"), label: providerActivityToolLabel(payloadRecord, "Provider tool"), preview: optionalStringEventValue(payloadRecord, "preview"), durationMs: optionalNumberEventValue(payloadRecord, "durationMs"), error, state: hasError ? "failed" : "completed" } });
    }
    case "approval_required":
      return withBase({ id: event.id, kind: "approval", title: "Approval required", summary: provider, description: provider, tone: "warning", timestamp });
    case "run_completed":
      return withBase({ id: event.id, kind: "provider_run", title: "Provider run completed", summary: provider, description: provider, tone: "success", timestamp });
    case "run_failed":
      return withBase({ id: event.id, kind: "provider_run", title: "Provider run failed", summary: providerActivityDescription(payloadRecord, provider), description: providerActivityDescription(payloadRecord, provider), tone: "danger", timestamp });
    case "run_cancelled":
      return withBase({ id: event.id, kind: "provider_run", title: "Provider run cancelled", summary: provider, description: provider, tone: "warning", timestamp });
    default:
      return withBase({ id: event.id, kind: "raw", title: "Provider event", summary: providerActivityDescription(payloadRecord, eventType), description: providerActivityDescription(payloadRecord, eventType), tone: "neutral", timestamp });
  }
}

function taskActivityItem(input: Omit<WorkspaceActivityTimelineItem, "summary"> & { summary?: string }) {
  return { ...input, summary: input.summary ?? input.description } satisfies WorkspaceActivityTimelineItem;
}

function eventTimestamp(event: TaskActivityEvent) {
  return (event.occurredAt ?? event.createdAt).toISOString();
}

function mapTaskEventToActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem {
  if (event.source === "provider" || event.eventType.startsWith("provider.")) {
    return mapProviderEventToActivity(event);
  }

  const timestamp = eventTimestamp(event);
  const payload = event.payload;

  switch (event.eventType) {
    case "task.created":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task created",
        description: compactParts([
          stringPayloadValue(payload, "title"),
          stringPayloadValue(payload, "status"),
          stringPayloadValue(payload, "priority"),
        ]) || "Task was created.",
        tone: "info",
        timestamp,
      });
    case "task.updated": {
      const changedFields = arrayPayloadValue(payload, "changed_fields")?.filter((field): field is string => typeof field === "string") ?? [];
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Task updated",
        description: changedFields.length > 0 ? `Updated ${changedFields.join(", ")}` : "Task fields changed.",
        tone: "info",
        timestamp,
      });
    }
    case "task.deleted":
      return taskActivityItem({ id: event.id, kind: "task", title: "Task deleted", description: "Task was deleted.", tone: "warning", timestamp });
    case "task.result_accepted":
      return taskActivityItem({ id: event.id, kind: "task", title: "Result accepted", description: stringPayloadValue(payload, "summary") ?? "Task result was accepted.", tone: "success", timestamp });
    case "task.reopened":
      return taskActivityItem({ id: event.id, kind: "task", title: "Task reopened", description: stringPayloadValue(payload, "reason") ?? "Task was reopened.", tone: "warning", timestamp });
    case "task.done":
    case "task.marked_done":
      return taskActivityItem({ id: event.id, kind: "task", title: "Task completed", description: stringPayloadValue(payload, "reason") ?? "Task was marked done.", tone: "success", timestamp });
    case "task.schedule_changed":
      return taskActivityItem({
        id: event.id,
        kind: "schedule",
        title: "Schedule changed",
        description: compactParts([
          stringPayloadValue(payload, "scheduledStartAt"),
          stringPayloadValue(payload, "scheduledEndAt"),
          stringPayloadValue(payload, "source"),
        ]) || "Task schedule changed.",
        tone: "info",
        timestamp,
      });
    case "task.schedule_proposed":
      return taskActivityItem({ id: event.id, kind: "schedule", title: "Schedule proposed", description: stringPayloadValue(payload, "summary") ?? "A schedule was proposed.", tone: "info", timestamp });
    case "task.auto_start.skipped":
      return taskActivityItem({ id: event.id, kind: "schedule", title: "Auto-start skipped", description: stringPayloadValue(payload, "reason") ?? "Scheduled task was not auto-started.", tone: "warning", timestamp });
    case "plan_generation.started":
      return taskActivityItem({ id: event.id, kind: "task", title: "Plan generation started", description: stringPayloadValue(payload, "instruction") ?? "Generating a task plan.", tone: "info", timestamp });
    case "plan_generation.status":
      return taskActivityItem({ id: event.id, kind: "task", title: "Plan generation update", description: stringPayloadValue(payload, "message") ?? stringPayloadValue(payload, "phase") ?? "Plan generation progressed.", tone: "info", timestamp });
    case "plan_generation.tool_called":
      return taskActivityItem({
        id: event.id,
        kind: "task",
        title: "Plan tool called",
        description: compactParts([
          stringPayloadValue(payload, "tool"),
          stringPayloadValue(payload, "plan_title"),
          numberPayloadValue(payload, "node_count") !== null ? `${numberPayloadValue(payload, "node_count")} nodes` : null,
        ]) || "AI produced a plan blueprint.",
        tone: "info",
        timestamp,
      });
    case "plan_generation.draft_saved":
      return taskActivityItem({ id: event.id, kind: "task", title: "Plan draft saved", description: stringPayloadValue(payload, "plan_title") ?? "Generated plan draft was saved.", tone: "success", timestamp });
    case "plan_generation.completed":
      return taskActivityItem({ id: event.id, kind: "task", title: "Plan generated", description: stringPayloadValue(payload, "plan_title") ?? "Plan generation completed.", tone: "success", timestamp });
    case "plan_generation.failed":
      return taskActivityItem({ id: event.id, kind: "task", title: "Plan generation failed", description: stringPayloadValue(payload, "message") ?? stringPayloadValue(payload, "code") ?? "Plan generation failed.", tone: "danger", timestamp });
    case "plan_generation.cancelled":
      return taskActivityItem({ id: event.id, kind: "task", title: "Plan generation cancelled", description: "Plan generation was cancelled.", tone: "warning", timestamp });
    default:
      if (event.eventType.startsWith("plan_execution.")) {
        const title = humanizeEventType(event.eventType);
        const status = stringPayloadValue(payload, "status");
        const description = compactParts([
          event.nodeTitle,
          stringPayloadValue(payload, "checkpoint_id"),
          status,
        ]) || event.eventType;
        const tone = event.eventType.includes("failed") || status === "failed" ? "danger" : event.eventType.includes("completed") || status === "completed" ? "success" : "info";
        return taskActivityItem({ id: event.id, kind: "node", title, description, tone, timestamp, sourceNodeId: event.nodeId ?? undefined, sourceNodeTitle: event.nodeTitle ?? undefined });
      }
      return taskActivityItem({ id: event.id, kind: "raw", title: "Task event", description: humanizeEventType(event.eventType), tone: "neutral", timestamp });
  }
}

function buildActivityTimeline(events: TaskActivityEvent[]) {
  const items: WorkspaceActivityTimelineItem[] = [];
  let currentTextSegment: { key: string; item: WorkspaceActivityTimelineItem } | null = null;

  for (const event of events) {
    const payloadEvent = runtimePayloadEvent(event.payload);
    const eventType = providerActivityEventType(event, payloadEvent);

    if (event.source !== "provider" || !payloadEvent || !isMergeableProviderTextEvent(eventType)) {
      currentTextSegment = null;
      items.push(mapTaskEventToActivity(event));
      continue;
    }

    const key = providerActivityMergeKey(event, eventType);
    const text = providerActivityText(payloadEvent) ?? "";
    const nextItem = mapProviderEventToActivity(event);

    if (currentTextSegment !== null && currentTextSegment.key === key) {
      currentTextSegment.item.description = `${currentTextSegment.item.description}${text}`;
      currentTextSegment.item.summary = currentTextSegment.item.description;
      currentTextSegment.item.assistant = {
        text: currentTextSegment.item.description,
        isReasoning: eventType === "reasoning_delta",
        isPartial: true,
      };
      currentTextSegment.item.timestamp = nextItem.timestamp;
      continue;
    }

    nextItem.description = text || nextItem.description;
    nextItem.summary = nextItem.description;
    if (nextItem.assistant) nextItem.assistant.text = nextItem.description;
    items.push(nextItem);
    currentTextSegment = { key, item: nextItem };
  }

  return items;
}

function activitySortValue(item: WorkspaceActivityTimelineItem) {
  return item.timestamp ? Date.parse(item.timestamp) : 0;
}

function orderActivityNewestFirst(items: WorkspaceActivityTimelineItem[]) {
  return [...items].sort((a, b) => {
    const timestampDelta = activitySortValue(b) - activitySortValue(a);
    if (timestampDelta !== 0) return timestampDelta;
    return (b.sequence ?? 0) - (a.sequence ?? 0);
  });
}

function timelineTone(severity: string | null): WorkspaceActivityTimelineItem["tone"] {
  if (severity === "warning") return "warning";
  if (severity === "danger" || severity === "error") return "danger";
  if (severity === "success") return "success";
  if (severity === "info") return "info";
  return "neutral";
}

function mapTimelineItemToActivity(item: TaskTimelineActivityItem): WorkspaceActivityTimelineItem {
  return taskActivityItem({
    id: item.id,
    kind: item.kind.startsWith("plan_execution.") ? "node" : "task",
    title: item.title,
    description: item.body ?? item.status ?? item.kind,
    tone: timelineTone(item.severity),
    timestamp: item.sortTime.toISOString(),
    sourceNodeId: item.nodeId ?? undefined,
    raw: item.metadata,
  });
}

async function resolveActivityCursor(cursor: string | undefined): Promise<ActivityCursor | null> {
  if (!cursor) return null;

  const timelineItem = await db.taskTimelineItem.findUnique({
    where: { id: cursor },
    select: { sortTime: true },
  });
  if (timelineItem) return { source: "timeline", timestamp: timelineItem.sortTime };

  const event = await db.event.findUnique({
    where: { id: cursor },
    select: { occurredAt: true, createdAt: true },
  });
  if (event) return { source: "event", timestamp: event.occurredAt ?? event.createdAt };

  return null;
}

function timelineCursorWhere<T extends Record<string, unknown>>(
  where: T,
  cursor: ActivityCursor | null,
) {
  if (!cursor) return where;

  return {
    ...where,
    sortTime: { lt: cursor.timestamp },
  };
}

function eventCursorWhere<T extends Record<string, unknown>>(
  where: T,
  cursor: ActivityCursor | null,
) {
  if (!cursor) return where;

  return {
    ...where,
    OR: [
      { occurredAt: { lt: cursor.timestamp } },
      { occurredAt: null, createdAt: { lt: cursor.timestamp } },
    ],
  };
}

async function getMergedActivity(input: {
  taskId: string;
  nodeId?: string;
  cursor?: string;
  limit: number;
}) {
  const cursor = await resolveActivityCursor(input.cursor);
  const take = Math.min(input.limit * 3, 3000) + 1;
  const baseWhere = input.nodeId
    ? { taskId: input.taskId, nodeId: input.nodeId }
    : { taskId: input.taskId };
  const [timelineItems, events] = await Promise.all([
    db.taskTimelineItem.findMany({
      where: timelineCursorWhere(baseWhere, cursor),
      orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
      take,
    }),
    db.event.findMany({
      where: eventCursorWhere(baseWhere, cursor),
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }, { ingestSequence: "desc" }],
      take,
    }),
  ]);
  const activity = orderActivityNewestFirst([
    ...timelineItems.map(mapTimelineItemToActivity),
    ...buildActivityTimeline([...events].reverse()),
  ]);
  const items = activity.slice(0, input.limit);

  return {
    items,
    nextCursor: activity.length > input.limit ? items.at(-1)?.id : undefined,
  };
}

export async function getTaskActivityPage(input: TaskActivityPageInput) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 3000);
  const scope = input.scope ?? "task";
  if (scope === "node" && !input.nodeId) {
    throw new Error("nodeId is required for node activity");
  }
  const activity = await getMergedActivity({
    taskId: input.taskId,
    ...(scope === "node" && input.nodeId ? { nodeId: input.nodeId } : {}),
    cursor: input.cursor,
    limit,
  });

  return {
    items: activity.items,
    nextCursor: activity.nextCursor,
    scope: {
      type: scope,
      taskId: input.taskId,
      ...(scope === "node" && input.nodeId ? { nodeId: input.nodeId } : {}),
      limit,
    },
  };
}

export async function getTaskPage(taskId: string) {
  const savedPlan = await getLatestTaskPlanReadModel(taskId);
  const aiPlanGenerationStatus: TaskPlanGenerationStatus =
    isTaskPlanGenerationRunning(taskId)
      ? "generating"
      : savedPlan !== null && savedPlan.status === "accepted"
        ? "accepted"
        : savedPlan !== null
          ? "waiting_acceptance"
          : "idle";

  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      projection: true,
      runs: { orderBy: { createdAt: "desc" }, take: 1 },
      approvals: { orderBy: { requestedAt: "desc" }, take: 5 },
      artifacts: { orderBy: { createdAt: "desc" }, take: 5 },
      timelineItems: {
        orderBy: [{ sortTime: "desc" }, { createdAt: "desc" }],
        take: 100,
      },
      events: {
        orderBy: { ingestSequence: "desc" },
        take: 300,
      },
      scheduleProposals: {
        where: { status: "Pending" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      workspace: {
        select: { defaultRuntime: true },
      },
      dependencies: {
        include: {
          dependsOnTask: {
            select: { id: true, title: true, status: true },
          },
        },
      },
    },
  });

  const latestRun = task.runs[0] ?? null;
  const runnability = deriveTaskRunnability({
    executionRuntime: task.executionRuntime || task.workspace.defaultRuntime,
    executionConfig: task.executionConfig,
  });
  const orchestratorState = savedPlan?.effectivePlan
    ? reconcileTaskState({
        taskId,
        graph: savedPlan.effectivePlan,
        runnable: runnability.isRunnable,
        readinessReason: runnability.summary,
        taskStatus: task.status,
        blockReason: readBlockReason(task),
      })
    : null;

  return {
    defaultExecutionRuntime: task.workspace.defaultRuntime,
    executionRuntimes: listExecutionRuntimes().map((key) => ({
      key,
      label: key,
      spec: getRuntimeTaskConfigSpec(key),
    })),
    task: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      description: task.description,
      executionRuntime: task.executionRuntime,
      executionConfig: task.executionConfig,
      autoPlanGeneration: task.autoPlanGeneration,
      autoExecute: task.autoExecute,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt?.toISOString() ?? null,
      scheduledStartAt:
        task.projection?.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: task.projection?.scheduledEndAt?.toISOString() ?? null,
      scheduleStatus: task.projection?.scheduleStatus ?? "Unscheduled",
      scheduleSource: task.projection?.scheduleSource ?? null,
      isRunnable: runnability.isRunnable,
      runnabilityState: runnability.state,
      runnabilitySummary: runnability.summary,
      savedPlan,
      aiPlanGenerationStatus,
      blockReason: readBlockReason(task),
      dependencies: task.dependencies.map((dependency) => ({
        id: dependency.id,
        dependencyType: dependency.dependencyType,
        dependsOnTask: dependency.dependsOnTask,
      })),
      executionSummary: orchestratorState?.summary ?? null,
      graphNodeStates: orchestratorState?.nodes ?? [],
    },
    reconciliation: orchestratorState?.reconciliation ?? null,
    latestRunSummary: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt?.toISOString() ?? null,
          syncStatus: latestRun.syncStatus,
        }
      : null,
    scheduleProposals: task.scheduleProposals.map((proposal) => ({
      id: proposal.id,
      source: proposal.source,
      proposedBy: proposal.proposedBy,
      summary: proposal.summary,
      status: proposal.status,
      dueAt: proposal.dueAt?.toISOString() ?? null,
      scheduledStartAt: proposal.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: proposal.scheduledEndAt?.toISOString() ?? null,
    })),
    approvals: task.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      riskLevel: approval.riskLevel,
      requestedAt: approval.requestedAt.toISOString(),
    })),
    artifacts: task.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
    })),
    activityTimeline: task.timelineItems.length > 0
      ? orderActivityNewestFirst([
          ...task.timelineItems.map(mapTimelineItemToActivity),
          ...buildActivityTimeline([...task.events].reverse()),
        ]).slice(0, 100)
      : buildActivityTimeline([...task.events].reverse()),
  };
}

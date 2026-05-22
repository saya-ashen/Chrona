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
  title: string;
  description: string;
  tone: "success" | "warning" | "critical" | "info" | "neutral";
  timestamp?: string | null;
};

type TaskActivityEvent = {
  id: string;
  eventType: string;
  source: string;
  payload: unknown;
  runtimeTs: Date | null;
  createdAt: Date;
};

function readBlockReason(task: {
  blockReason: unknown;
  projection: {
    blockType: string | null;
    actionRequired: string | null;
    blockScope: string | null;
    blockSince: Date | null;
  } | null;
}) {
  return (
    (task.blockReason as {
      blockType?: string;
      actionRequired?: string;
      scope?: string;
      since?: string;
    } | null) ??
    (task.projection
      ? {
          blockType: task.projection.blockType ?? undefined,
          actionRequired: task.projection.actionRequired ?? undefined,
          scope: task.projection.blockScope ?? undefined,
          since: task.projection.blockSince?.toISOString(),
        }
      : null)
  );
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
  ].join(":");
}

function isMergeableProviderTextEvent(eventType: string) {
  return eventType === "text_delta" || eventType === "reasoning_delta";
}

function mapProviderEventToActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem {
  const payloadEvent = runtimePayloadEvent(event.payload);
  const provider = stringPayloadValue(event.payload, "provider") ?? stringPayloadValue(event.payload, "runtimeName") ?? "provider";
  const eventType = providerActivityEventType(event, payloadEvent);
  const timestamp = (event.runtimeTs ?? event.createdAt).toISOString();

  switch (eventType) {
    case "run_started":
      return { id: event.id, title: "Provider run started", description: provider, tone: "info", timestamp };
    case "text_delta":
      return { id: event.id, title: "Assistant response", description: providerActivityDescription(payloadEvent ?? {}, "Assistant output streamed."), tone: "info", timestamp };
    case "reasoning_delta":
      return { id: event.id, title: "Reasoning", description: providerActivityDescription(payloadEvent ?? {}, "Reasoning streamed."), tone: "neutral", timestamp };
    case "tool_call":
    case "tool_started":
      return { id: event.id, title: "Tool started", description: providerActivityDescription(payloadEvent ?? {}, "Provider tool started."), tone: "info", timestamp };
    case "tool_result":
    case "tool_completed": {
      const hasError = Boolean(payloadEvent && "error" in payloadEvent && payloadEvent.error);
      return { id: event.id, title: hasError ? "Tool failed" : "Tool completed", description: providerActivityDescription(payloadEvent ?? {}, "Provider tool completed."), tone: hasError ? "critical" : "success", timestamp };
    }
    case "approval_required":
      return { id: event.id, title: "Approval required", description: provider, tone: "warning", timestamp };
    case "run_completed":
      return { id: event.id, title: "Provider run completed", description: provider, tone: "success", timestamp };
    case "run_failed":
      return { id: event.id, title: "Provider run failed", description: providerActivityDescription(payloadEvent ?? {}, provider), tone: "critical", timestamp };
    case "run_cancelled":
      return { id: event.id, title: "Provider run cancelled", description: provider, tone: "warning", timestamp };
    default:
      return { id: event.id, title: "Provider event", description: providerActivityDescription(payloadEvent ?? {}, eventType), tone: "neutral", timestamp };
  }
}

function eventTimestamp(event: TaskActivityEvent) {
  return (event.runtimeTs ?? event.createdAt).toISOString();
}

function mapTaskEventToActivity(event: TaskActivityEvent): WorkspaceActivityTimelineItem {
  if (event.source === "provider" || event.eventType.startsWith("provider.")) {
    return mapProviderEventToActivity(event);
  }

  const timestamp = eventTimestamp(event);
  const payload = event.payload;

  switch (event.eventType) {
    case "task.created":
      return {
        id: event.id,
        title: "Task created",
        description: compactParts([
          stringPayloadValue(payload, "title"),
          stringPayloadValue(payload, "status"),
          stringPayloadValue(payload, "priority"),
        ]) || "Task was created.",
        tone: "info",
        timestamp,
      };
    case "task.updated": {
      const changedFields = arrayPayloadValue(payload, "changed_fields")?.filter((field): field is string => typeof field === "string") ?? [];
      return {
        id: event.id,
        title: "Task updated",
        description: changedFields.length > 0 ? `Updated ${changedFields.join(", ")}` : "Task fields changed.",
        tone: "info",
        timestamp,
      };
    }
    case "task.deleted":
      return { id: event.id, title: "Task deleted", description: "Task was deleted.", tone: "warning", timestamp };
    case "task.result_accepted":
      return { id: event.id, title: "Result accepted", description: stringPayloadValue(payload, "summary") ?? "Task result was accepted.", tone: "success", timestamp };
    case "task.reopened":
      return { id: event.id, title: "Task reopened", description: stringPayloadValue(payload, "reason") ?? "Task was reopened.", tone: "warning", timestamp };
    case "task.done":
    case "task.marked_done":
      return { id: event.id, title: "Task completed", description: stringPayloadValue(payload, "reason") ?? "Task was marked done.", tone: "success", timestamp };
    case "task.schedule_changed":
      return {
        id: event.id,
        title: "Schedule changed",
        description: compactParts([
          stringPayloadValue(payload, "scheduledStartAt"),
          stringPayloadValue(payload, "scheduledEndAt"),
          stringPayloadValue(payload, "source"),
        ]) || "Task schedule changed.",
        tone: "info",
        timestamp,
      };
    case "task.schedule_proposed":
      return { id: event.id, title: "Schedule proposed", description: stringPayloadValue(payload, "summary") ?? "A schedule was proposed.", tone: "info", timestamp };
    case "task.auto_start.skipped":
      return { id: event.id, title: "Auto-start skipped", description: stringPayloadValue(payload, "reason") ?? "Scheduled task was not auto-started.", tone: "warning", timestamp };
    case "plan_generation.started":
      return { id: event.id, title: "Plan generation started", description: stringPayloadValue(payload, "instruction") ?? "Generating a task plan.", tone: "info", timestamp };
    case "plan_generation.status":
      return { id: event.id, title: "Plan generation update", description: stringPayloadValue(payload, "message") ?? stringPayloadValue(payload, "phase") ?? "Plan generation progressed.", tone: "info", timestamp };
    case "plan_generation.tool_called":
      return {
        id: event.id,
        title: "Plan tool called",
        description: compactParts([
          stringPayloadValue(payload, "tool"),
          stringPayloadValue(payload, "plan_title"),
          numberPayloadValue(payload, "node_count") !== null ? `${numberPayloadValue(payload, "node_count")} nodes` : null,
        ]) || "AI produced a plan blueprint.",
        tone: "info",
        timestamp,
      };
    case "plan_generation.draft_saved":
      return { id: event.id, title: "Plan draft saved", description: stringPayloadValue(payload, "plan_title") ?? "Generated plan draft was saved.", tone: "success", timestamp };
    case "plan_generation.completed":
      return { id: event.id, title: "Plan generated", description: stringPayloadValue(payload, "plan_title") ?? "Plan generation completed.", tone: "success", timestamp };
    case "plan_generation.failed":
      return { id: event.id, title: "Plan generation failed", description: stringPayloadValue(payload, "message") ?? stringPayloadValue(payload, "code") ?? "Plan generation failed.", tone: "critical", timestamp };
    case "plan_generation.cancelled":
      return { id: event.id, title: "Plan generation cancelled", description: "Plan generation was cancelled.", tone: "warning", timestamp };
    default:
      if (event.eventType.startsWith("plan_execution.")) {
        const title = humanizeEventType(event.eventType);
        const status = stringPayloadValue(payload, "status");
        const description = compactParts([
          stringPayloadValue(payload, "node_id"),
          stringPayloadValue(payload, "checkpoint_id"),
          status,
        ]) || event.eventType;
        const tone = event.eventType.includes("failed") || status === "failed" ? "critical" : event.eventType.includes("completed") || status === "completed" ? "success" : "info";
        return { id: event.id, title, description, tone, timestamp };
      }
      return { id: event.id, title: "Task event", description: humanizeEventType(event.eventType), tone: "neutral", timestamp };
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
      currentTextSegment.item.timestamp = nextItem.timestamp;
      continue;
    }

    nextItem.description = text || nextItem.description;
    items.push(nextItem);
    currentTextSegment = { key, item: nextItem };
  }

  return items;
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
      events: {
        orderBy: { ingestSequence: "desc" },
        take: 100,
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
    activityTimeline: buildActivityTimeline([...task.events].reverse()),
  };
}

import { db } from "@/lib/db";
import { syncTaskRunForRead } from "@/modules/runtime-sync/freshness";
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

function mapProviderEventToActivity(event: {
  id: string;
  eventType: string;
  payload: unknown;
  runtimeTs: Date | null;
  createdAt: Date;
}): WorkspaceActivityTimelineItem {
  const payloadEvent = runtimePayloadEvent(event.payload);
  const provider = stringPayloadValue(event.payload, "provider") ?? stringPayloadValue(event.payload, "runtimeName") ?? "provider";
  const eventType = payloadEvent && typeof payloadEvent.type === "string" ? payloadEvent.type : event.eventType.replace(/^provider\./, "");
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

export async function getTaskPage(taskId: string) {
  await syncTaskRunForRead(taskId);

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
        where: { source: "provider" },
        orderBy: { ingestSequence: "desc" },
        take: 50,
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
    activityTimeline: [...task.events].reverse().map(mapProviderEventToActivity),
  };
}

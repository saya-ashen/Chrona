import { SYNC_STALE_MS } from "@/modules/openclaw/freshness";
import { getAcceptedTaskPlanGraph, getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import type { EvidenceItem, TaskPlanProjection, TaskPlanProjectionStep, WorkPageCopy } from "./types";
import { makeEvidence, toIsoString } from "./helpers";

export function buildScheduleImpact(task: {
  scheduleStatus: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
}, copy: WorkPageCopy) {
  return {
    status: task.scheduleStatus,
    dueAt: toIsoString(task.dueAt),
    scheduledStartAt: toIsoString(task.scheduledStartAt),
    scheduledEndAt: toIsoString(task.scheduledEndAt),
    summary:
      task.scheduleStatus === "Unscheduled"
        ? copy.noPlannedWindowYet
        : task.scheduleStatus === "AtRisk"
        ? copy.executionTimingSlipping
        : task.scheduleStatus === "Overdue"
          ? copy.overdueRecovery
          : copy.scheduleAligned,
  };
}

export function readBlockReason(
  task: {
    blockReason: unknown;
    projection:
      | {
          actionRequired: string | null;
          blockType: string | null;
          blockScope: string | null;
          blockSince: Date | null;
        }
      | null;
  },
) {
  return (
    (task.blockReason as {
      actionRequired?: string;
      blockType?: string;
      scope?: string;
      since?: string;
    } | null) ??
    (task.projection
      ? {
          actionRequired: task.projection.actionRequired ?? undefined,
          blockType: task.projection.blockType ?? undefined,
          scope: task.projection.blockScope ?? undefined,
          since: task.projection.blockSince?.toISOString(),
        }
      : null)
  );
}

export function deriveTaskPlanStepStatus(
  stepId: string,
  currentRun: { status: string } | null,
  closure: { isDone: boolean },
): "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked" {
  if (closure.isDone) {
    return "done";
  }

  switch (stepId) {
    case "understand-task":
      return currentRun ? "done" : "in_progress";
    case "gather-context":
      if (!currentRun) {
        return "pending";
      }

      if (currentRun.status === "WaitingForInput") {
        return "waiting_for_user";
      }

      if (["Running", "WaitingForApproval", "Completed", "Failed", "Cancelled"].includes(currentRun.status)) {
        return "done";
      }

      return "in_progress";
    case "execute-task":
      if (!currentRun) {
        return "pending";
      }

      if (currentRun.status === "Running") {
        return "in_progress";
      }

      if (currentRun.status === "WaitingForApproval" || currentRun.status === "WaitingForInput") {
        return "waiting_for_user";
      }

      if (currentRun.status === "Completed") {
        return "done";
      }

      if (currentRun.status === "Failed" || currentRun.status === "Cancelled") {
        return "blocked";
      }

      return "pending";
    case "confirm-next-step":
      if (!currentRun) {
        return "pending";
      }

      if (currentRun.status === "Completed") {
        return "waiting_for_user";
      }

      return "pending";
    default:
      if (!currentRun) {
        return "pending";
      }

      if (currentRun.status === "Completed") {
        return "done";
      }

      if (currentRun.status === "Failed" || currentRun.status === "Cancelled") {
        return "blocked";
      }

      if (currentRun.status === "WaitingForInput" || currentRun.status === "WaitingForApproval") {
        return "waiting_for_user";
      }

      return "in_progress";
  }
}

export function buildTaskPlanFromGraph({
  savedPlan,
}: {
  savedPlan: Awaited<ReturnType<typeof getAcceptedTaskPlanGraph>> | Awaited<ReturnType<typeof getLatestTaskPlanGraph>>;
}): TaskPlanProjection | null {
  if (!savedPlan) {
    return null;
  }

  const steps: TaskPlanProjectionStep[] = savedPlan.plan.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    objective: node.objective,
    phase: node.phase ?? node.type,
    status: node.status === "skipped" ? "done" : node.status,
    needsUserInput: node.needsUserInput || node.status === "waiting_for_user",
    type: node.type,
    linkedTaskId: node.linkedTaskId,
    executionMode: node.executionMode,
    estimatedMinutes: node.estimatedMinutes,
    priority: node.priority,
  }));

  const currentStepId =
    steps.find((step) => ["in_progress", "waiting_for_user", "blocked"].includes(step.status))?.id ?? null;

  return {
    state: "ready",
    revision: `r${savedPlan.revision}`,
    generatedBy: savedPlan.generatedBy,
    isMock: false,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
    changeSummary: savedPlan.changeSummary,
    currentStepId,
    steps,
    edges: savedPlan.plan.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      type: edge.type,
    })),
  };
}

export function buildCurrentIntervention({
  taskTitle,
  currentRun,
  approvals,
  blockReason,
  latestOutput,
  workstreamItems,
  toolCalls,
  scheduleImpact,
  copy,
}: {
  taskTitle: string;
  currentRun:
    | {
        id: string;
        status: string;
        pendingInputPrompt?: string | null;
      }
    | null;
  approvals: Array<{ id: string; title: string; status: string; summary?: string }>;
  blockReason: ReturnType<typeof readBlockReason>;
  latestOutput: {
    title: string;
    body: string;
    href: string | null;
    empty: boolean;
  };
  workstreamItems: Array<{
    title: string;
    summary: string;
    kind: string;
    whyItMatters: string;
  }>;
  toolCalls: Array<{
    toolName: string;
    status: string;
    errorSummary?: string | null;
    resultSummary?: string | null;
  }>;
  scheduleImpact: {
    status: string;
    summary: string;
  };
  copy: WorkPageCopy;
}) {
  const latestWorkstreamItem = [...workstreamItems].reverse()[0] ?? null;
  const latestToolIssue = [...toolCalls].reverse().find((tool) => tool.errorSummary || tool.status === "failed") ?? null;
  const sharedEvidence: EvidenceItem[] = [];

  if (!latestOutput.empty) {
    sharedEvidence.push({
      label: copy.latestOutput,
      value: latestOutput.title,
      tone: "neutral",
      href: latestOutput.href,
    });
  }

  if (latestWorkstreamItem) {
    sharedEvidence.push({
      label: copy.latestMilestone,
      value: latestWorkstreamItem.summary,
      tone: latestWorkstreamItem.kind === "failure" ? "critical" : "neutral",
    });
  }

  if (scheduleImpact.status === "AtRisk" || scheduleImpact.status === "Overdue") {
    sharedEvidence.push({
      label: copy.scheduleImpact,
      value: scheduleImpact.summary,
      tone: scheduleImpact.status === "Overdue" ? "critical" : "warning",
    });
  }

  if (!currentRun) {
    return {
      kind: "idle",
      title: copy.startExecution,
      description: copy.noRunActiveDescription,
      actionLabel: copy.startRunHere,
      whyNow: blockReason?.actionRequired ?? copy.noActiveRunWhy,
      evidence: sharedEvidence,
    } as const;
  }

  switch (currentRun.status) {
    case "WaitingForInput":
      return {
        kind: "input",
        title: copy.provideInput,
        description: currentRun.pendingInputPrompt ?? blockReason?.actionRequired ?? copy.waitingForGuidance,
        actionLabel: copy.sendToAgent,
        defaultMessage: currentRun.pendingInputPrompt ?? `Continue work on ${taskTitle}`,
        whyNow: blockReason?.actionRequired ?? copy.pausedUntilReply,
        evidence: [
          makeEvidence({
            label: copy.requestedGuidance,
            value: currentRun.pendingInputPrompt ?? `Continue work on ${taskTitle}`,
            tone: "warning",
          }),
          ...sharedEvidence,
        ].slice(0, 3),
      } as const;
    case "WaitingForApproval":
      return {
        kind: "approval",
        title: copy.resolveApproval,
        description:
          approvals[0]?.summary ??
          blockReason?.actionRequired ??
          copy.blockedOnApproval,
        actionLabel: copy.approveRejectEdit,
        approvals,
        whyNow: blockReason?.actionRequired ?? copy.humanDecisionRequired,
        evidence: [
          makeEvidence({
            label: copy.pendingApproval,
            value: approvals[0]?.title ?? copy.approvalRequest,
            tone: "warning",
          }),
          ...(approvals[0]?.summary
            ? [
                makeEvidence({
                  label: copy.approvalSummary,
                  value: approvals[0].summary,
                  tone: "warning",
                }),
              ]
            : []),
          ...sharedEvidence,
        ].slice(0, 3),
      } as const;
    case "Failed":
    case "Cancelled":
      return {
        kind: "retry",
        title: copy.recoverRun,
        description: blockReason?.actionRequired ?? copy.stoppedBeforeFinishing,
        actionLabel: copy.retryRun,
        defaultMessage: `Retry task: ${taskTitle}`,
        whyNow: blockReason?.actionRequired ?? copy.executionStopped,
        evidence: [
          ...(latestToolIssue
            ? [
                makeEvidence({
                  label: copy.latestToolIssue,
                  value: latestToolIssue.errorSummary ?? `${latestToolIssue.toolName} ended in ${latestToolIssue.status}`,
                  tone: "critical",
                }),
              ]
            : []),
          ...sharedEvidence,
        ].slice(0, 3),
      } as const;
    case "Completed":
      return {
        kind: "review",
        title: copy.reviewResult,
        description: copy.completedDescription,
        actionLabel: copy.reviewOutput,
        whyNow: copy.resultAvailableWhy,
        evidence: sharedEvidence.slice(0, 3),
      } as const;
    case "Running":
      return {
        kind: "observe",
        title: copy.observeProgress,
        description: copy.runActiveDescription,
        actionLabel: copy.watchWorkstream,
        whyNow: copy.agentExecutingWhy,
        evidence: sharedEvidence.slice(0, 3),
      } as const;
    default:
      return {
        kind: "observe",
        title: copy.checkRunState,
        description: copy.inspectBeforeActing,
        actionLabel: copy.inspectRun,
        whyNow: copy.stateNeedsInspection,
        evidence: sharedEvidence.slice(0, 3),
      } as const;
  }
}

export function buildLatestOutput({
  artifacts,
  conversation,
  copy,
}: {
  artifacts: Array<{
    id: string;
    title: string;
    type: string;
    uri?: string | null;
    createdAt: Date;
  }>;
  conversation: Array<{
    id: string;
    role: string;
    content: string;
    runtimeTs?: Date | null;
  }>;
  copy: WorkPageCopy;
}) {
  const latestArtifact = [...artifacts].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  if (latestArtifact) {
    return {
      kind: "artifact" as const,
      title: latestArtifact.title,
      body: latestArtifact.type,
      timestamp: latestArtifact.createdAt.toISOString(),
      href: latestArtifact.uri ?? null,
      empty: false,
      sourceLabel: copy.latestAgentOutput,
    };
  }

  const latestConversation = [...conversation]
    .filter((entry) => entry.role === "assistant")
    .sort((left, right) => {
      const leftTs = left.runtimeTs?.getTime() ?? 0;
      const rightTs = right.runtimeTs?.getTime() ?? 0;
      return rightTs - leftTs;
    })[0] ?? null;

  if (latestConversation) {
    return {
      kind: "message" as const,
      title: copy.latestOutput,
      body: latestConversation.content,
      timestamp: latestConversation.runtimeTs?.toISOString() ?? null,
      href: null,
      empty: false,
      sourceLabel: copy.conversationOutput,
    };
  }

  return {
    kind: "empty" as const,
    title: copy.noMappedOutputYet,
    body: copy.latestArtifactAppears,
    timestamp: null,
    href: null,
    empty: true,
    sourceLabel: copy.noOutputSource,
  };
}

export function buildReliability({
  currentRun,
  blockReason,
  now,
}: {
  currentRun:
    | {
        lastSyncedAt?: string | null;
        updatedAt?: string | null;
        syncStatus?: string | null;
        errorSummary?: string | null;
      }
    | null;
  blockReason: ReturnType<typeof readBlockReason>;
  now: Date;
}) {
  const lastSyncedAt = currentRun?.lastSyncedAt ?? null;
  const lastUpdatedAt = currentRun?.updatedAt ?? null;
  const lastSyncedAtMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;
  const staleAgeMs = lastSyncedAtMs ? now.getTime() - lastSyncedAtMs : null;
  const isStale = staleAgeMs !== null ? staleAgeMs > SYNC_STALE_MS : currentRun?.syncStatus === "stale";

  const stuckFor =
    staleAgeMs !== null && staleAgeMs > 0
      ? `${Math.max(1, Math.round(staleAgeMs / 60000))} min`
      : null;

  return {
    refreshedAt: now.toISOString(),
    lastSyncedAt,
    lastUpdatedAt,
    syncStatus: currentRun?.syncStatus ?? null,
    isStale,
    stuckFor,
    stopReason: blockReason?.actionRequired ?? currentRun?.errorSummary ?? null,
  };
}

export function buildClosureState({
  task,
  currentRun,
  events,
  latestFollowUp,
}: {
  task: { status: string; completedAt: Date | null };
  currentRun:
    | {
        id: string;
        status: string;
        endedAt?: string | null;
      }
    | null;
  events: Array<{ eventType: string; runId?: string | null; createdAt: Date }>;
  latestFollowUp:
    | {
        id: string;
        title: string;
        status: string;
        scheduleStatus: string;
        createdAt: Date;
      }
    | null;
}) {
  const acceptanceEvent = [...events]
    .reverse()
    .find((event) => event.eventType === "task.result_accepted" && (!currentRun || event.runId === currentRun.id));
  const resultAccepted = Boolean(acceptanceEvent);
  const acceptedAt = acceptanceEvent?.createdAt.toISOString() ?? null;
  const isDone = task.status === "Completed";
  const doneAt = task.completedAt?.toISOString() ?? currentRun?.endedAt ?? null;
  const currentRunStatus = currentRun?.status ?? null;

  const canReviewResult = currentRunStatus === "Completed" && !resultAccepted;
  const canMarkDone = isDone ? false : currentRunStatus === "Completed" || resultAccepted;
  const canRetry = ["Failed", "Cancelled"].includes(currentRunStatus ?? "");
  const canReopen = isDone;
  const canCreateFollowUp = currentRunStatus === "Completed" || resultAccepted || isDone;

  return {
    resultAccepted,
    acceptedAt,
    isDone,
    doneAt,
    canAcceptResult: canReviewResult,
    canMarkDone,
    canCreateFollowUp,
    canRetry,
    canReopen,
    latestFollowUp: latestFollowUp
      ? {
          id: latestFollowUp.id,
          title: latestFollowUp.title,
          status: latestFollowUp.status,
          scheduleStatus: latestFollowUp.scheduleStatus,
          createdAt: latestFollowUp.createdAt.toISOString(),
        }
      : null,
  };
}

export function buildWorkspaceRail(
  currentTaskId: string,
  projections: Array<{
    taskId: string;
    persistedStatus: string;
    displayState?: string | null;
    task: { id: string; title: string };
  }>,
  currentTask: {
    title: string;
    persistedStatus: string;
    displayState?: string | null;
  },
) {
  const items = [
    {
      taskId: currentTaskId,
      title: currentTask.title,
      statusLabel: currentTask.displayState ?? currentTask.persistedStatus,
      tone: "current",
      isCurrent: true,
    },
    ...projections
      .filter((projection) => projection.taskId !== currentTaskId)
      .slice(0, 8)
      .map((projection) => ({
        taskId: projection.taskId,
        title: projection.task.title,
        statusLabel: projection.displayState ?? projection.persistedStatus,
        tone: "default",
        isCurrent: false,
      })),
  ];

  return {
    sections: [
      {
        id: "workspace-context",
        title: "Workspace context",
        items,
      },
    ],
  };
}

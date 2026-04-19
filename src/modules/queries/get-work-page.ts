import { db } from "@/lib/db";
import { SYNC_STALE_MS, syncTaskRunForRead } from "@/modules/runtime/openclaw/freshness";
import { getAcceptedTaskPlanGraph, getLatestTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

export class WorkPageTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Work page task not found: ${taskId}`);
    this.name = "WorkPageTaskNotFoundError";
  }
}

function isMissingRecordError(error: unknown) {
  return error instanceof Error && error.message.includes("No record was found for a query");
}

type WorkPageCopy = {
  needsApproval: string;
  needsInput: string;
  needsRecovery: string;
  result: string;
  output: string;
  progress: string;
  humanApprovalMatters: string;
  linkedToNextAction: string;
  recoveryEvidence: string;
  feedsSharedOutput: string;
  noPlannedWindowYet: string;
  executionTimingSlipping: string;
  overdueRecovery: string;
  scheduleAligned: string;
  latestOutput: string;
  latestMilestone: string;
  scheduleImpact: string;
  startExecution: string;
  noRunActiveDescription: string;
  noActiveRunWhy: string;
  provideInput: string;
  waitingForGuidance: string;
  pausedUntilReply: string;
  requestedGuidance: string;
  resolveApproval: string;
  blockedOnApproval: string;
  humanDecisionRequired: string;
  pendingApproval: string;
  approvalRequest: string;
  approvalSummary: string;
  recoverRun: string;
  stoppedBeforeFinishing: string;
  executionStopped: string;
  latestToolIssue: string;
  reviewResult: string;
  completedDescription: string;
  resultAvailableWhy: string;
  observeProgress: string;
  runActiveDescription: string;
  agentExecutingWhy: string;
  checkRunState: string;
  inspectBeforeActing: string;
  stateNeedsInspection: string;
  startRunHere: string;
  sendToAgent: string;
  approveRejectEdit: string;
  retryRun: string;
  reviewOutput: string;
  watchWorkstream: string;
  inspectRun: string;
  latestAgentOutput: string;
  conversationOutput: string;
  noMappedOutputYet: string;
  latestArtifactAppears: string;
  noOutputSource: string;
};

const DEFAULT_COPY: WorkPageCopy = {
  needsApproval: "Needs approval",
  needsInput: "Needs input",
  needsRecovery: "Needs recovery",
  result: "Result",
  output: "Output",
  progress: "Progress",
  humanApprovalMatters: "Human approval or review directly affects whether this run can continue.",
  linkedToNextAction: "Linked to Next Action",
  recoveryEvidence: "Recovery evidence",
  feedsSharedOutput: "Feeds Shared Output",
  noPlannedWindowYet: "No planned window exists yet. Place or adjust the task from Schedule.",
  executionTimingSlipping: "Execution timing is slipping against the planned window.",
  overdueRecovery: "The task is beyond its expected window and needs recovery.",
  scheduleAligned: "Schedule remains aligned with the current plan.",
  latestOutput: "Latest output",
  latestMilestone: "Latest milestone",
  scheduleImpact: "Schedule impact",
  startExecution: "Start execution",
  noRunActiveDescription: "No run is active yet. Launch one from this workbench once the task is ready in Schedule.",
  noActiveRunWhy: "There is no active run, so execution cannot progress from this page yet.",
  provideInput: "Provide input",
  waitingForGuidance: "The agent is waiting for operator guidance.",
  pausedUntilReply: "The run is paused until the operator replies.",
  requestedGuidance: "Requested guidance",
  resolveApproval: "Resolve approval",
  blockedOnApproval: "The run is blocked on an approval decision before it can continue.",
  humanDecisionRequired: "A human decision is required before the next execution step can proceed.",
  pendingApproval: "Pending approval",
  approvalRequest: "Approval request",
  approvalSummary: "Approval summary",
  recoverRun: "Recover run",
  stoppedBeforeFinishing: "The last run stopped before finishing. Retry with a focused recovery prompt.",
  executionStopped: "Execution stopped and will not progress until a recovery action is taken.",
  latestToolIssue: "Latest tool issue",
  reviewResult: "Review result",
  completedDescription: "The run completed. Review the latest result and continue directly from the workbench when you are ready.",
  resultAvailableWhy: "The latest result is available. The key decision now is how to keep the work moving, not how to step through a complex closing flow.",
  observeProgress: "Observe progress",
  runActiveDescription: "The run is still active. Watch the newest milestones and intervene only if the state changes.",
  agentExecutingWhy: "The agent is currently executing, so the best next step is to monitor the newest evidence.",
  checkRunState: "Check run state",
  inspectBeforeActing: "Review the latest output and inspector state before acting.",
  stateNeedsInspection: "The run state needs inspection before the next action is clear.",
  startRunHere: "Start Run Here",
  sendToAgent: "Send to Agent",
  approveRejectEdit: "Approve / Reject / Edit",
  retryRun: "Retry Run",
  reviewOutput: "Review Output",
  watchWorkstream: "Watch Workstream",
  inspectRun: "Inspect Run",
  latestAgentOutput: "Latest agent output",
  conversationOutput: "Conversation output",
  noMappedOutputYet: "No mapped output yet",
  latestArtifactAppears: "The latest artifact or agent result will appear here first.",
  noOutputSource: "No output source",
};

type EvidenceItem = {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "critical";
  href?: string | null;
};

type TaskPlanStepStatus = "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";

type TaskPlanProjectionStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
  status: TaskPlanStepStatus;
  needsUserInput: boolean;
  type?: string;
  linkedTaskId?: string | null;
  executionMode?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
};

type TaskPlanProjection = {
  state: "empty" | "ready";
  revision: string | null;
  generatedBy: string | null;
  isMock: boolean;
  summary: string | null;
  updatedAt: string | null;
  changeSummary: string | null;
  currentStepId: string | null;
  steps: TaskPlanProjectionStep[];
  edges: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    type: string;
  }>;
};

function makeEvidence(item: EvidenceItem) {
  return item;
}

function toIsoString(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function summarizeValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }

  if (value && typeof value === "object") {
    return "details";
  }

  return "-";
}

function summarizePayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload).slice(0, 3);

  if (entries.length === 0) {
    return "No structured payload recorded.";
  }

  return entries.map(([key, value]) => `${key}: ${summarizeValue(value)}`).join(" · ");
}

function formatEventTitle(eventType: string) {
  return eventType
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifyWorkstreamItem(eventType: string, copy: WorkPageCopy) {
  if (/approval/i.test(eventType)) {
    return {
      kind: "approval",
      badge: copy.needsApproval,
      whyItMatters: copy.humanApprovalMatters,
      linkedEvidenceLabel: copy.linkedToNextAction,
    } as const;
  }

  if (/input/i.test(eventType)) {
    return {
      kind: "input",
      badge: copy.needsInput,
      whyItMatters: copy.waitingForGuidance,
      linkedEvidenceLabel: copy.linkedToNextAction,
    } as const;
  }

  if (/fail|error|blocked|reject/i.test(eventType)) {
    return {
      kind: "failure",
      badge: copy.needsRecovery,
      whyItMatters: "This event likely explains why the run stalled or needs a retry path.",
      linkedEvidenceLabel: copy.recoveryEvidence,
    } as const;
  }

  if (/complete|finish/i.test(eventType)) {
    return {
      kind: "result",
      badge: copy.result,
      whyItMatters: "This milestone helps explain the latest outcome and what follow-up may be needed.",
      linkedEvidenceLabel: copy.feedsSharedOutput,
    } as const;
  }

  if (/artifact|memory|output/i.test(eventType)) {
    return {
      kind: "output",
      badge: copy.output,
      whyItMatters: "This event produced material that can guide the next decision or handoff.",
      linkedEvidenceLabel: copy.feedsSharedOutput,
    } as const;
  }

  return {
    kind: "progress",
    badge: copy.progress,
    whyItMatters: "This shows the latest execution progress without demanding immediate action.",
    linkedEvidenceLabel: null,
  } as const;
}

function buildScheduleImpact(task: {
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

function readBlockReason(
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

function deriveTaskPlanStepStatus(
  stepId: string,
  currentRun: { status: string } | null,
  closure: { isDone: boolean },
): TaskPlanStepStatus {
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

function buildTaskPlanFromGraph({
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

function buildCurrentIntervention({
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

function buildLatestOutput({
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

function buildReliability({
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

function buildClosureState({
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

function buildWorkspaceRail(
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

export async function getWorkPage(taskId: string, copy: Partial<WorkPageCopy> = {}) {
  const mergedCopy = { ...DEFAULT_COPY, ...copy };

  const taskExists = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });

  if (!taskExists) {
    throw new WorkPageTaskNotFoundError(taskId);
  }

  try {
    await syncTaskRunForRead(taskId, undefined, { forceActive: true });
  } catch (error) {
    if (isMissingRecordError(error)) {
      const taskStillExists = await db.task.findUnique({
        where: { id: taskId },
        select: { id: true },
      });

      if (!taskStillExists) {
        throw new WorkPageTaskNotFoundError(taskId);
      }
    }

    throw error;
  }
  const now = new Date();

  const task = await db.task.findUnique({
    where: { id: taskId },
    include: {
      projection: true,
      events: { orderBy: [{ runtimeTs: "asc" }, { ingestSequence: "asc" }], take: 100 },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
          artifacts: { orderBy: { createdAt: "desc" } },
          conversationEntries: { orderBy: { sequence: "asc" } },
          toolCallDetails: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!task) {
    throw new WorkPageTaskNotFoundError(taskId);
  }

  const workspaceProjections = await db.taskProjection.findMany({
    where: { workspaceId: task.workspaceId },
    include: {
      task: {
        select: {
          id: true,
          title: true,
        },
      },
    },
    orderBy: [{ lastActivityAt: "desc" }, { updatedAt: "desc" }],
    take: 24,
  });

  const currentRun = task.runs[0] ?? null;
  const latestFollowUp = await db.task.findFirst({
    where: { parentTaskId: task.id },
    orderBy: { createdAt: "desc" },
  });
  const savedPlan = (await getAcceptedTaskPlanGraph(task.id)) ?? (await getLatestTaskPlanGraph(task.id));
  const blockReason = readBlockReason(task);
  const approvals =
    currentRun?.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      summary: approval.summary,
    })) ?? [];
  const allConversationEntries = await db.conversationEntry.findMany({
    where: { run: { taskId: task.id } },
    include: {
      run: {
        select: {
          id: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ runtimeTs: "asc" }, { createdAt: "asc" }, { sequence: "asc" }],
  });
  const conversation = allConversationEntries
    .slice()
    .sort((left, right) => {
      const leftRuntimeTs = left.runtimeTs?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightRuntimeTs = right.runtimeTs?.getTime() ?? Number.POSITIVE_INFINITY;

      if (leftRuntimeTs !== rightRuntimeTs) {
        return leftRuntimeTs - rightRuntimeTs;
      }

      const leftRunCreatedAt = left.run.createdAt.getTime();
      const rightRunCreatedAt = right.run.createdAt.getTime();
      if (leftRunCreatedAt !== rightRunCreatedAt) {
        return leftRunCreatedAt - rightRunCreatedAt;
      }

      if (left.runId !== right.runId) {
        return left.runId.localeCompare(right.runId);
      }

      return left.sequence - right.sequence;
    })
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: toIsoString(entry.runtimeTs),
    }));
  const artifacts =
    currentRun?.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      createdAt: toIsoString(artifact.createdAt),
    })) ?? [];
  const toolCalls =
    currentRun?.toolCallDetails.map((tool) => ({
      id: tool.id,
      toolName: tool.toolName,
      status: tool.status,
      argumentsSummary: tool.argumentsSummary,
      resultSummary: tool.resultSummary,
      errorSummary: tool.errorSummary,
    })) ?? [];
  const workstreamItems = task.events.map((event) => {
    const eventInfo = classifyWorkstreamItem(event.eventType, mergedCopy);

    return {
      id: event.id,
      eventType: event.eventType,
      title: formatEventTitle(event.eventType),
      summary: summarizePayload(event.payload as Record<string, unknown>),
      payload: event.payload as Record<string, unknown>,
      runtimeTs: toIsoString(event.runtimeTs),
      runId: event.runId,
      kind: eventInfo.kind,
      badge: eventInfo.badge,
      whyItMatters: eventInfo.whyItMatters,
      linkedEvidenceLabel: eventInfo.linkedEvidenceLabel,
    };
  });
  const serializedRun = currentRun
    ? {
        id: currentRun.id,
        status: currentRun.status,
        startedAt: toIsoString(currentRun.startedAt),
        endedAt: toIsoString(currentRun.endedAt),
        updatedAt: toIsoString(currentRun.updatedAt),
        lastSyncedAt: toIsoString(currentRun.lastSyncedAt),
        syncStatus: currentRun.syncStatus,
        resumeSupported: currentRun.resumeSupported,
        pendingInputPrompt: currentRun.pendingInputPrompt,
        errorSummary: currentRun.errorSummary,
      }
    : null;

  const latestOutput = buildLatestOutput({
    artifacts: currentRun?.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
      createdAt: artifact.createdAt,
    })) ?? [],
    conversation: currentRun?.conversationEntries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: entry.runtimeTs,
    })) ?? [],
    copy: mergedCopy,
  });
  const scheduleImpact = buildScheduleImpact(task, mergedCopy);
  const reliability = buildReliability({
    currentRun: serializedRun,
    blockReason,
    now,
  });
  const closure = buildClosureState({
    task: {
      status: task.status,
      completedAt: task.completedAt,
    },
    currentRun: serializedRun,
    events: task.events.map((event) => ({
      eventType: event.eventType,
      runId: event.runId,
      createdAt: event.createdAt,
    })),
    latestFollowUp,
  });
  const taskPlan = buildTaskPlanFromGraph({ savedPlan }) ?? {
    state: "empty" as const,
    revision: null,
    generatedBy: null,
    isMock: false,
    summary: null,
    updatedAt: null,
    changeSummary: null,
    currentStepId: null,
    steps: [],
    edges: [],
  };

  return {
    taskShell: {
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      runtimeModel: task.runtimeModel,
      prompt: task.prompt,
      status: task.projection?.displayState ?? task.status,
      priority: task.priority,
      dueAt: toIsoString(task.dueAt),
      scheduledStartAt: toIsoString(task.scheduledStartAt),
      scheduledEndAt: toIsoString(task.scheduledEndAt),
      scheduleStatus: task.scheduleStatus,
      blockReason,
    },
    currentRun: serializedRun,
    currentIntervention: buildCurrentIntervention({
      taskTitle: task.title,
      currentRun: serializedRun,
      approvals,
      blockReason,
      latestOutput,
      workstreamItems,
      toolCalls,
      scheduleImpact,
      copy: mergedCopy,
    }),
    latestOutput,
    scheduleImpact,
    reliability,
    closure,
    taskPlan,
    workspaceRail: buildWorkspaceRail(task.id, workspaceProjections, {
      title: task.title,
      persistedStatus: task.status,
      displayState: task.projection?.displayState ?? null,
    }),
    workstreamItems,
    conversation,
    composerValue: "",
    inspector: {
      approvals,
      artifacts,
      toolCalls,
    },
  };
}

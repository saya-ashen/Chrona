import { db } from "@/lib/db";
import { SYNC_STALE_MS, syncTaskRunForRead } from "@/modules/runtime/openclaw/freshness";

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

type TaskPlanPayloadStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTaskPlanPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const steps = Array.isArray(payload.steps)
    ? payload.steps.flatMap((step) => {
        if (!isRecord(step)) {
          return [];
        }

        if (
          typeof step.id !== "string" ||
          typeof step.title !== "string" ||
          typeof step.objective !== "string" ||
          typeof step.phase !== "string"
        ) {
          return [];
        }

        return [{
          id: step.id,
          title: step.title,
          objective: step.objective,
          phase: step.phase,
        } satisfies TaskPlanPayloadStep];
      })
    : [];

  if (steps.length === 0) {
    return null;
  }

  return {
    revision: payload.revision === "updated" ? "updated" : "generated",
    generatedBy: typeof payload.generated_by === "string" ? payload.generated_by : null,
    isMock: payload.is_mock !== false,
    summary: typeof payload.summary === "string" ? payload.summary : null,
    changeSummary: typeof payload.change_summary === "string" ? payload.change_summary : null,
    steps,
  };
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

      if (currentRun.status === "WaitingForApproval") {
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

      return "in_progress";
  }
}

function buildTaskPlan({
  taskTitle,
  latestPlanEvent,
  currentRun,
  closure,
}: {
  taskTitle: string;
  latestPlanEvent:
    | {
        eventType: string;
        payload: unknown;
        createdAt: Date;
        runtimeTs: Date | null;
      }
    | null;
  currentRun: { status: string } | null;
  closure: { isDone: boolean };
}) {
  if (!latestPlanEvent) {
    return {
      state: "empty" as const,
      revision: null,
      generatedBy: null,
      isMock: true,
      summary: null,
      updatedAt: null,
      changeSummary: null,
      currentStepId: null,
      steps: [],
    };
  }

  const parsed = readTaskPlanPayload(latestPlanEvent.payload);

  if (!parsed) {
    return {
      state: "empty" as const,
      revision: null,
      generatedBy: null,
      isMock: true,
      summary: null,
      updatedAt: null,
      changeSummary: null,
      currentStepId: null,
      steps: [],
    };
  }

  const steps = parsed.steps.map((step) => {
    const status = deriveTaskPlanStepStatus(step.id, currentRun, closure);
    return {
      ...step,
      status,
      needsUserInput: status === "waiting_for_user",
    };
  });

  return {
    state: "ready" as const,
    revision:
      latestPlanEvent.eventType === "task.plan_updated"
        ? "updated"
        : parsed.revision,
    generatedBy: parsed.generatedBy,
    isMock: parsed.isMock,
    summary:
      parsed.summary ??
      `围绕「${taskTitle}」先澄清目标与背景，再推进首轮产出，并在关键节点回到工作台和你确认。`,
    updatedAt: toIsoString(latestPlanEvent.runtimeTs ?? latestPlanEvent.createdAt),
    changeSummary: parsed.changeSummary,
    currentStepId:
      steps.find((step) => ["in_progress", "waiting_for_user", "blocked"].includes(step.status))?.id ?? null,
    steps,
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
        kind: "idle",
        title: copy.checkRunState,
        description: blockReason?.actionRequired ?? copy.inspectBeforeActing,
        actionLabel: copy.inspectRun,
        whyNow: blockReason?.actionRequired ?? copy.stateNeedsInspection,
        evidence: sharedEvidence.slice(0, 3),
      } as const;
  }
}

function buildLatestOutput({
  artifacts,
  conversation,
  copy,
}: {
  artifacts: Array<{ id: string; title: string; type: string; uri?: string | null; createdAt?: Date | null }>;
  conversation: Array<{ id: string; role: string; content: string; runtimeTs?: Date | null }>;
  copy: WorkPageCopy;
}) {
  const latestArtifact = artifacts[0];

  if (latestArtifact) {
    return {
      kind: "artifact",
      title: latestArtifact.title,
      body: `Type: ${latestArtifact.type}`,
      timestamp: toIsoString(latestArtifact.createdAt),
      href: latestArtifact.uri ?? null,
      empty: false,
      sourceLabel: `Artifact · ${latestArtifact.type}`,
    } as const;
  }

  const latestAgentOutput = [...conversation].reverse().find((entry) => entry.role !== "user");

  if (latestAgentOutput) {
    return {
      kind: "message",
      title: copy.latestAgentOutput,
      body: latestAgentOutput.content,
      timestamp: toIsoString(latestAgentOutput.runtimeTs),
      href: null,
      empty: false,
      sourceLabel: copy.conversationOutput,
    } as const;
  }

  return {
    kind: "empty",
    title: copy.noMappedOutputYet,
    body: copy.latestArtifactAppears,
    timestamp: null,
    href: null,
    empty: true,
    sourceLabel: copy.noOutputSource,
  } as const;
}

function formatDuration(ms: number | null) {
  if (ms === null || ms < 0) {
    return null;
  }

  const minutes = Math.floor(ms / 60000);

  if (minutes < 1) {
    return "<1m";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

function buildReliability({
  currentRun,
  blockReason,
  now,
}: {
  currentRun:
    | {
        status: string;
        startedAt: string | null;
        endedAt: string | null;
        updatedAt: string | null;
        lastSyncedAt: string | null;
        syncStatus: string | null;
        errorSummary: string | null;
      }
    | null;
  blockReason: ReturnType<typeof readBlockReason>;
  now: Date;
}) {
  if (!currentRun) {
    return {
      refreshedAt: now.toISOString(),
      lastSyncedAt: null,
      lastUpdatedAt: null,
      syncStatus: null,
      isStale: false,
      stuckFor: null,
      stopReason: blockReason?.actionRequired ?? null,
    };
  }

  const lastSyncedAt = currentRun.lastSyncedAt ? new Date(currentRun.lastSyncedAt) : null;
  const lastUpdatedAt = currentRun.updatedAt ? new Date(currentRun.updatedAt) : null;
  const activeStatuses = new Set(["Pending", "Running", "WaitingForInput", "WaitingForApproval"]);
  const syncReference = lastSyncedAt ?? lastUpdatedAt;
  const isStale = Boolean(
    currentRun.syncStatus === "stale" ||
      (activeStatuses.has(currentRun.status) && syncReference && now.getTime() - syncReference.getTime() > SYNC_STALE_MS),
  );

  let stopReason = currentRun.errorSummary ?? blockReason?.actionRequired ?? null;

  if (!stopReason) {
    if (currentRun.status === "WaitingForInput") {
      stopReason = "Waiting for operator input";
    } else if (currentRun.status === "WaitingForApproval") {
      stopReason = "Waiting for approval decision";
    } else if (currentRun.status === "Completed") {
      stopReason = "Run finished and is ready for review";
    } else if (currentRun.status === "Cancelled") {
      stopReason = "Run was cancelled before completion";
    }
  }

  return {
    refreshedAt: now.toISOString(),
    lastSyncedAt: currentRun.lastSyncedAt,
    lastUpdatedAt: currentRun.updatedAt,
    syncStatus: currentRun.syncStatus,
    isStale,
    stuckFor:
      activeStatuses.has(currentRun.status) && syncReference
        ? formatDuration(now.getTime() - syncReference.getTime())
        : null,
    stopReason,
  };
}

function buildClosureState({
  task,
  currentRun,
  events,
  latestFollowUp,
}: {
  task: { status: string; completedAt: Date | null };
  currentRun: { id: string; status: string } | null;
  events: Array<{ eventType: string; runId: string | null; createdAt: Date }>;
  latestFollowUp:
    | { id: string; title: string; status: string; scheduleStatus: string; createdAt: Date }
    | null;
}) {
  const latestReopenedAt =
    [...events].reverse().find((event) => event.eventType === "task.reopened")?.createdAt ?? null;
  const latestAcceptedEvent = [...events].reverse().find(
    (event) =>
      event.eventType === "task.result_accepted" &&
      (!currentRun || event.runId === currentRun.id) &&
      (!latestReopenedAt || event.createdAt > latestReopenedAt),
  );

  return {
    resultAccepted: Boolean(latestAcceptedEvent),
    acceptedAt: toIsoString(latestAcceptedEvent?.createdAt),
    isDone: task.status === "Done",
    doneAt: toIsoString(task.completedAt),
    canAcceptResult: currentRun?.status === "Completed" && !latestAcceptedEvent,
    canMarkDone: currentRun?.status === "Completed" && task.status !== "Done",
    canCreateFollowUp: currentRun?.status === "Completed",
    canRetry: currentRun ? ["Completed", "Failed", "Cancelled"].includes(currentRun.status) : false,
    canReopen: task.status === "Done",
    latestFollowUp: latestFollowUp
      ? {
          id: latestFollowUp.id,
          title: latestFollowUp.title,
          status: latestFollowUp.status,
          scheduleStatus: latestFollowUp.scheduleStatus,
          createdAt: toIsoString(latestFollowUp.createdAt),
        }
      : null,
  };
}

function buildWorkspaceRail(
  currentTaskId: string,
  projections: Array<{
    taskId: string;
    persistedStatus: string;
    displayState: string | null;
    lastActivityAt: Date | null;
    updatedAt: Date;
    task: { id: string; title: string };
  }>,
  currentTask?: {
    title: string;
    persistedStatus: string;
    displayState: string | null;
    updatedAt: Date;
    lastActivityAt?: Date | null;
  },
) {
  const waitingStates = new Set(["WaitingForApproval", "WaitingForInput", "Attention Needed", "Sync Stale"]);

  const baseItems = projections.map((item) => ({
    taskId: item.taskId,
    title: item.task.title,
    persistedStatus: item.persistedStatus,
    displayState: item.displayState,
    updatedAt: item.updatedAt,
    lastActivityAt: item.lastActivityAt,
  }));

  if (currentTask && !baseItems.some((item) => item.taskId === currentTaskId)) {
    baseItems.unshift({
      taskId: currentTaskId,
      title: currentTask.title,
      persistedStatus: currentTask.persistedStatus,
      displayState: currentTask.displayState,
      updatedAt: currentTask.updatedAt,
      lastActivityAt: currentTask.lastActivityAt ?? currentTask.updatedAt,
    });
  }

  const mapped = baseItems.map((item) => {
    const tone = waitingStates.has(item.displayState ?? "")
      ? "waiting"
      : item.persistedStatus === "Done" || item.persistedStatus === "Completed"
        ? "done"
        : "active";

    return {
      taskId: item.taskId,
      title: item.title,
      statusLabel: item.displayState ?? item.persistedStatus,
      tone,
      isCurrent: item.taskId === currentTaskId,
      sortAt: item.lastActivityAt ?? item.updatedAt,
    };
  });

  function takeWithCurrent(
    items: typeof mapped,
    limit: number,
  ) {
    const currentIndex = items.findIndex((item) => item.isCurrent);

    if (currentIndex === -1 || currentIndex < limit) {
      return items.slice(0, limit);
    }

    return [items[currentIndex], ...items.filter((_, index) => index !== currentIndex).slice(0, limit - 1)];
  }

  const sections = [
    {
      id: "in-progress",
      title: "In progress",
      items: takeWithCurrent(
        mapped.filter((item) => item.tone === "active"),
        6,
      ),
    },
    {
      id: "waiting-on-me",
      title: "Waiting on me",
      items: takeWithCurrent(
        mapped.filter((item) => item.tone === "waiting"),
        6,
      ),
    },
    {
      id: "completed",
      title: "Completed",
      items: takeWithCurrent(
        mapped.filter((item) => item.tone === "done"),
        6,
      ),
    },
  ].filter((section) => section.items.length > 0)
    .map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({
        taskId: item.taskId,
        title: item.title,
        statusLabel: item.statusLabel,
        tone: item.tone,
        isCurrent: item.isCurrent,
      })),
    }));

  return { sections };
}

export async function getWorkPage(taskId: string, copyOverrides?: Partial<WorkPageCopy>) {
  const copy = { ...DEFAULT_COPY, ...copyOverrides };
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
  const latestPlanEvent = await db.event.findFirst({
    where: {
      taskId: task.id,
      eventType: { in: ["task.plan_generated", "task.plan_updated"] },
    },
    orderBy: [{ runtimeTs: "desc" }, { ingestSequence: "desc" }],
    select: {
      eventType: true,
      payload: true,
      createdAt: true,
      runtimeTs: true,
    },
  });
  const blockReason = readBlockReason(task);
  const approvals =
    currentRun?.approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      status: approval.status,
      summary: approval.summary,
    })) ?? [];
  const conversation =
    currentRun?.conversationEntries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      content: entry.content,
      runtimeTs: toIsoString(entry.runtimeTs),
    })) ?? [];
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
    const eventInfo = classifyWorkstreamItem(event.eventType, copy);

    return {
      id: event.id,
      eventType: event.eventType,
      title: formatEventTitle(event.eventType),
      summary: summarizePayload(event.payload as Record<string, unknown>),
      payload: event.payload as Record<string, unknown>,
      runtimeTs: toIsoString(event.runtimeTs),
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
    copy,
  });
  const scheduleImpact = buildScheduleImpact(task, copy);
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
  const taskPlan = buildTaskPlan({
    taskTitle: task.title,
    latestPlanEvent,
    currentRun: serializedRun,
    closure,
  });

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
      copy,
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
      updatedAt: task.updatedAt,
      lastActivityAt: task.projection?.lastActivityAt,
    }),
    workstreamItems,
    conversation,
    inspector: {
      approvals,
      artifacts,
      toolCalls,
    },
  };
}

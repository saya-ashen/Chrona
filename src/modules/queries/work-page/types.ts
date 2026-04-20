export type WorkPageCopy = {
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

export const DEFAULT_COPY: WorkPageCopy = {
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

export type EvidenceItem = {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "critical";
  href?: string | null;
};

export type TaskPlanStepStatus = "pending" | "in_progress" | "waiting_for_user" | "done" | "blocked";

export type TaskPlanProjectionStep = {
  id: string;
  title: string;
  objective: string;
  phase: string;
  status: TaskPlanStepStatus;
  requiresHumanInput: boolean;
  type?: string;
  linkedTaskId?: string | null;
  executionMode?: string | null;
  estimatedMinutes?: number | null;
  priority?: string | null;
};

export type TaskPlanProjection = {
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

export class WorkPageTaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Work page task not found: ${taskId}`);
    this.name = "WorkPageTaskNotFoundError";
  }
}

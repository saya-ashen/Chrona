export type WorkStateCanonical =
  | "no_plan"
  | "planning"
  | "plan_review"
  | "ready_to_run"
  | "queued"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "cancelled"
  | "result_ready"
  | "done";

export type WorkStateStage = "brief" | "plan" | "review" | "run" | "result";
export type WorkStateTone =
  "neutral" | "info" | "success" | "warning" | "danger";

export type WorkStatePrimaryActionId =
  | "generate_plan"
  | "stop_generation"
  | "accept_plan"
  | "start_execution"
  | "open_execution"
  | "monitor_execution"
  | "provide_input"
  | "review_approval"
  | "resolve_blocker"
  | "retry"
  | "inspect_audit"
  | "accept_result"
  | "ask_follow_up";

export type WorkStateBlocker = {
  kind: string;
  reason: string;
  scope: "task" | "run" | "plan_node" | "runtime";
};

export type WorkStateView = {
  state: WorkStateCanonical;
  stage: WorkStateStage;
  label: string;
  tone: WorkStateTone;
  nextActionLabel: string;
  primaryActionId: WorkStatePrimaryActionId | null;
  primaryActionDisabledReason: string | null;
  currentNodeId: string | null;
  currentNodeLabel: string | null;
  blocker: WorkStateBlocker | null;
  attentionRequired: boolean;
  showLiveProgress: boolean;
  canPause: boolean;
  canStop: boolean;
  source: {
    taskStatus: string | null;
    executionStatus: string | null;
    operationStatus: string | null;
    planStatus: string | null;
    planGenerationStatus: string | null;
  };
};

export type DeriveWorkStateViewInput = {
  taskStatus?: string | null;
  executionStatus?: string | null;
  operationStatus?: string | null;
  planStatus?: string | null;
  planGenerationStatus?: string | null;
  hasPlan?: boolean;
  hasAcceptedPlan?: boolean;
  isRunnable?: boolean;
  disabledReason?: string | null;
  currentNodeId?: string | null;
  currentNodeLabel?: string | null;
  blockReason?: {
    blockType?: string | null;
    actionRequired?: string | null;
    detail?: string | null;
    scope?: string | null;
    nodeId?: string | null;
  } | null;
};

type WorkStatePresentation = Omit<
  WorkStateView,
  | "primaryActionDisabledReason"
  | "currentNodeId"
  | "currentNodeLabel"
  | "blocker"
  | "source"
  | "attentionRequired"
  | "showLiveProgress"
  | "canPause"
  | "canStop"
>;

const PRESENTATION: Record<WorkStateCanonical, WorkStatePresentation> = {
  no_plan: {
    state: "no_plan",
    stage: "brief",
    label: "Needs plan",
    tone: "info",
    nextActionLabel: "Generate a plan before execution can start",
    primaryActionId: "generate_plan",
  },
  planning: {
    state: "planning",
    stage: "plan",
    label: "Planning",
    tone: "info",
    nextActionLabel:
      "Wait for Chrona to finish drafting the plan or stop generation",
    primaryActionId: "stop_generation",
  },
  plan_review: {
    state: "plan_review",
    stage: "review",
    label: "Plan ready",
    tone: "info",
    nextActionLabel: "Review the generated plan, then accept or revise it",
    primaryActionId: "accept_plan",
  },
  ready_to_run: {
    state: "ready_to_run",
    stage: "run",
    label: "Ready to run",
    tone: "success",
    nextActionLabel: "Review the run contract, then start execution",
    primaryActionId: "start_execution",
  },
  queued: {
    state: "queued",
    stage: "run",
    label: "Queued",
    tone: "info",
    nextActionLabel: "Open execution and monitor when the run starts",
    primaryActionId: "open_execution",
  },
  running: {
    state: "running",
    stage: "run",
    label: "Running",
    tone: "info",
    nextActionLabel: "Monitor the current step and next runtime event",
    primaryActionId: "monitor_execution",
  },
  waiting_for_input: {
    state: "waiting_for_input",
    stage: "run",
    label: "Input needed",
    tone: "warning",
    nextActionLabel: "Provide the requested input so execution can continue",
    primaryActionId: "provide_input",
  },
  waiting_for_approval: {
    state: "waiting_for_approval",
    stage: "run",
    label: "Approval needed",
    tone: "warning",
    nextActionLabel:
      "Review the request, then approve, reject, or request changes",
    primaryActionId: "review_approval",
  },
  blocked: {
    state: "blocked",
    stage: "run",
    label: "Blocked",
    tone: "danger",
    nextActionLabel: "Resolve the blocker before execution can continue",
    primaryActionId: "resolve_blocker",
  },
  failed: {
    state: "failed",
    stage: "run",
    label: "Failed",
    tone: "danger",
    nextActionLabel: "Review the failure reason, then retry or stop",
    primaryActionId: "retry",
  },
  cancelled: {
    state: "cancelled",
    stage: "run",
    label: "Cancelled",
    tone: "neutral",
    nextActionLabel: "Inspect the audit trail or reopen the task",
    primaryActionId: "inspect_audit",
  },
  result_ready: {
    state: "result_ready",
    stage: "result",
    label: "Result ready",
    tone: "info",
    nextActionLabel: "Accept result or request changes",
    primaryActionId: "accept_result",
  },
  done: {
    state: "done",
    stage: "result",
    label: "Task done",
    tone: "success",
    nextActionLabel: "Ask a follow-up or create a next task",
    primaryActionId: "ask_follow_up",
  },
};

function normalize(value: string | null | undefined) {
  return value?.replace(/[\s-]/g, "_").trim().toLowerCase() ?? "";
}

function normalizeCompact(value: string | null | undefined) {
  return normalize(value).replace(/_/g, "");
}

function isOneOf(value: string | null | undefined, options: readonly string[]) {
  const normalized = normalize(value);
  const compact = normalizeCompact(value);
  return options.some(
    (option) => normalized === option || compact === option.replace(/_/g, ""),
  );
}

function blockerScope(
  scope: string | null | undefined,
): WorkStateBlocker["scope"] {
  const value = normalize(scope);
  if (value === "runtime" || value === "run" || value === "task") return value;
  return "plan_node";
}

function deriveBlocker(
  input: DeriveWorkStateViewInput,
): WorkStateBlocker | null {
  const reason = input.blockReason;
  if (!reason) return null;
  const kind = reason.blockType?.trim() || "blocked";
  const detail = reason.detail?.trim() || reason.actionRequired?.trim() || kind;
  return {
    kind,
    reason: detail,
    scope: blockerScope(reason.scope),
  };
}

function stateFromBlocker(
  input: DeriveWorkStateViewInput,
): WorkStateCanonical | null {
  const blockType = normalize(input.blockReason?.blockType);
  if (!blockType) return null;
  if (blockType === "run_failed" || blockType === "node_failed")
    return "failed";
  if (blockType === "waiting_for_input" || blockType === "human_input_required")
    return "waiting_for_input";
  if (
    blockType === "waiting_for_approval" ||
    blockType === "approval_required" ||
    blockType === "approval_pending" ||
    blockType === "replan_required"
  )
    return "waiting_for_approval";
  return "blocked";
}

function deriveState(input: DeriveWorkStateViewInput): WorkStateCanonical {
  // Authoritative result decisions always win over stale runtime, node, or
  // generation facts. Once the user accepts a result, the task is done; an
  // unaccepted completed execution remains result-ready.
  if (isOneOf(input.taskStatus, ["done"])) return "done";
  if (
    isOneOf(input.executionStatus, ["completed"]) ||
    isOneOf(input.taskStatus, ["completed", "complete"])
  )
    return "result_ready";

  // Human waits outrank generic blocked/failed metadata because they carry a
  // specific, recoverable next action. Block reasons are checked before stale
  // terminal/run fields for the same reason.
  const blockerState = stateFromBlocker(input);
  if (
    blockerState === "waiting_for_approval" ||
    blockerState === "waiting_for_input"
  )
    return blockerState;
  if (
    isOneOf(input.executionStatus, ["waiting_for_approval"]) ||
    isOneOf(input.taskStatus, ["waiting_for_approval", "waitingforapproval"])
  )
    return "waiting_for_approval";
  if (
    isOneOf(input.executionStatus, ["waiting_for_user", "waiting_for_input"]) ||
    isOneOf(input.taskStatus, ["waiting_for_input", "waitingforinput"])
  )
    return "waiting_for_input";

  if (blockerState === "blocked") return "blocked";
  if (
    isOneOf(input.executionStatus, ["blocked", "degraded"]) ||
    isOneOf(input.taskStatus, ["blocked", "degraded", "attention_needed"])
  )
    return "blocked";
  if (
    blockerState === "failed" ||
    isOneOf(input.executionStatus, ["failed"]) ||
    isOneOf(input.taskStatus, ["failed"])
  )
    return "failed";
  if (
    isOneOf(input.executionStatus, ["cancelled", "canceled"]) ||
    isOneOf(input.taskStatus, ["cancelled", "canceled"])
  )
    return "cancelled";
  if (
    isOneOf(input.executionStatus, ["running", "started", "in_progress", "active"]) ||
    isOneOf(input.operationStatus, ["execution_running", "execution_action"]) ||
    isOneOf(input.taskStatus, ["running", "in_progress", "active"])
  )
    return "running";
  if (
    isOneOf(input.executionStatus, ["pending", "queued"]) ||
    isOneOf(input.taskStatus, ["queued"])
  )
    return "queued";
  if (
    isOneOf(input.operationStatus, ["plan_generating"]) ||
    isOneOf(input.planGenerationStatus, ["generating"])
  )
    return "planning";
  if (
    isOneOf(input.operationStatus, ["plan_review"]) ||
    (input.hasPlan === true && input.hasAcceptedPlan === false) ||
    isOneOf(input.planStatus, ["draft", "waiting_acceptance"])
  )
    return "plan_review";
  if (
    isOneOf(input.operationStatus, ["plan_ready_to_run"]) ||
    input.hasAcceptedPlan === true ||
    isOneOf(input.planStatus, ["accepted"])
  )
    return "ready_to_run";
  return "no_plan";
}

function disabledReasonFor(
  input: DeriveWorkStateViewInput,
  state: WorkStateCanonical,
) {
  const explicit = input.disabledReason?.trim();
  if (explicit) return explicit;
  if (
    input.isRunnable === false &&
    (state === "ready_to_run" || state === "no_plan" || state === "plan_review")
  ) {
    return "Task is not runnable.";
  }
  return null;
}

export function deriveWorkStateView(
  input: DeriveWorkStateViewInput,
): WorkStateView {
  const state = deriveState(input);
  const base = PRESENTATION[state];
  const disabledReason = disabledReasonFor(input, state);
  const isRunning = state === "running";
  const attentionRequired =
    state === "result_ready" ||
    state === "waiting_for_approval" ||
    state === "waiting_for_input" ||
    state === "blocked" ||
    state === "failed";
  return {
    ...base,
    primaryActionId: disabledReason ? null : base.primaryActionId,
    primaryActionDisabledReason: disabledReason,
    currentNodeId: input.currentNodeId ?? input.blockReason?.nodeId ?? null,
    currentNodeLabel: input.currentNodeLabel ?? null,
    blocker: deriveBlocker(input),
    attentionRequired,
    showLiveProgress: isRunning,
    canPause: isRunning,
    canStop: isRunning,
    source: {
      taskStatus: input.taskStatus ?? null,
      executionStatus: input.executionStatus ?? null,
      operationStatus: input.operationStatus ?? null,
      planStatus: input.planStatus ?? null,
      planGenerationStatus: input.planGenerationStatus ?? null,
    },
  };
}

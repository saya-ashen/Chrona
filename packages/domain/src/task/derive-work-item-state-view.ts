export type WorkItemUserState =
  | "unscheduled"
  | "scheduled"
  | "ready_to_plan"
  | "ready_to_execute"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "result_ready"
  | "done"
  | "cancelled";

export type WorkItemAction =
  | "schedule"
  | "generate_plan"
  | "accept_plan"
  | "start_execution"
  | "open_execution"
  | "provide_input"
  | "review_approval"
  | "resolve_blocker"
  | "retry"
  | "accept_result"
  | "review_result"
  | "reopen"
  | "ask_follow_up";

export type WorkItemStateSeverity = "neutral" | "info" | "warning" | "danger" | "success";

export type WorkItemStateView = {
  state: WorkItemUserState;
  label: string;
  description: string;
  severity: WorkItemStateSeverity;
  primaryAction: WorkItemAction | null;
  nextActionLabel: string;
  secondaryActions: WorkItemAction[];
  disabledReason?: string;
  source: {
    taskStatus?: string | null;
    scheduleStatus?: string | null;
    planStatus?: string | null;
    executionStatus?: string | null;
    providerStatus?: string | null;
    nodeStatus?: string | null;
  };
};

export type DeriveWorkItemStateViewInput = {
  taskStatus?: string | null;
  scheduleStatus?: string | null;
  planStatus?: string | null;
  executionStatus?: string | null;
  providerStatus?: string | null;
  nodeStatus?: string | null;
  isScheduled?: boolean;
  hasPlan?: boolean;
  isRunnable?: boolean;
  disabledReason?: string | null;
};

const NORMALIZED: Partial<Record<string, WorkItemUserState>> = {
  waitingforinput: "waiting_for_input",
  waiting_for_input: "waiting_for_input",
  waitingforuser: "waiting_for_input",
  waiting_for_user: "waiting_for_input",
  waitingforapproval: "waiting_for_approval",
  waiting_for_approval: "waiting_for_approval",
  approvalneeded: "waiting_for_approval",
  approval_needed: "waiting_for_approval",
  blocked: "blocked",
  attentionneeded: "blocked",
  attention_needed: "blocked",
  failed: "failed",
  error: "failed",
  running: "running",
  active: "running",
  inprogress: "running",
  in_progress: "running",
  pending: "running",
  started: "running",
  ready: "ready_to_execute",
  queued: "ready_to_execute",
  accepted: "ready_to_execute",
  waitingacceptance: "ready_to_plan",
  waiting_acceptance: "ready_to_plan",
  generated: "ready_to_plan",
  draft: "ready_to_plan",
  idle: "ready_to_plan",
  noplan: "ready_to_plan",
  no_plan: "ready_to_plan",
  scheduled: "scheduled",
  unscheduled: "unscheduled",
  completed: "result_ready",
  done: "done",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const PRIORITY: WorkItemUserState[] = [
  "failed",
  "blocked",
  "waiting_for_approval",
  "waiting_for_input",
  "running",
  "ready_to_execute",
  "ready_to_plan",
  "scheduled",
  "unscheduled",
  "cancelled",
  "result_ready",
  "done",
];
const TERMINAL_WORK_ITEM_STATES = new Set<WorkItemUserState>(["result_ready", "done", "cancelled"]);

const PRESENTATION: Record<WorkItemUserState, Omit<WorkItemStateView, "source" | "disabledReason">> = {
  unscheduled: {
    state: "unscheduled",
    label: "Unscheduled",
    description: "Needs a planned time window.",
    severity: "neutral",
    primaryAction: "schedule",
    nextActionLabel: "Schedule this task",
    secondaryActions: ["generate_plan"],
  },
  scheduled: {
    state: "scheduled",
    label: "Scheduled",
    description: "Scheduled but not ready to execute yet.",
    severity: "info",
    primaryAction: "generate_plan",
    nextActionLabel: "Generate or accept a plan",
    secondaryActions: [],
  },
  ready_to_plan: {
    state: "ready_to_plan",
    label: "Ready to plan",
    description: "Needs a generated or accepted plan before execution.",
    severity: "info",
    primaryAction: "generate_plan",
    nextActionLabel: "Generate a plan",
    secondaryActions: ["schedule"],
  },
  ready_to_execute: {
    state: "ready_to_execute",
    label: "Ready to execute",
    description: "Accepted plan is ready to run.",
    severity: "info",
    primaryAction: "start_execution",
    nextActionLabel: "Start execution",
    secondaryActions: [],
  },
  running: {
    state: "running",
    label: "Running",
    description: "Execution is in progress.",
    severity: "info",
    primaryAction: "open_execution",
    nextActionLabel: "Open execution",
    secondaryActions: [],
  },
  waiting_for_input: {
    state: "waiting_for_input",
    label: "Waiting for input",
    description: "Execution needs user input before it can continue.",
    severity: "warning",
    primaryAction: "provide_input",
    nextActionLabel: "Provide the requested input so execution can continue",
    secondaryActions: ["open_execution"],
  },
  waiting_for_approval: {
    state: "waiting_for_approval",
    label: "Waiting for approval",
    description: "Execution needs user approval before it can continue.",
    severity: "warning",
    primaryAction: "review_approval",
    nextActionLabel: "Review the request, then approve, reject, or request changes",
    secondaryActions: ["open_execution"],
  },
  blocked: {
    state: "blocked",
    label: "Blocked",
    description: "Execution is blocked and needs recovery.",
    severity: "danger",
    primaryAction: "resolve_blocker",
    nextActionLabel: "Resolve the blocker before execution can continue",
    secondaryActions: ["retry"],
  },
  failed: {
    state: "failed",
    label: "Failed",
    description: "Execution failed and needs recovery.",
    severity: "danger",
    primaryAction: "retry",
    nextActionLabel: "Review the failure reason, then retry or stop",
    secondaryActions: ["review_result"],
  },
  result_ready: {
    state: "result_ready",
    label: "Result ready",
    description: "Execution completed and the result is ready for review.",
    severity: "success",
    primaryAction: "accept_result",
    nextActionLabel: "Accept result or request changes",
    secondaryActions: ["review_result"],
  },
  done: {
    state: "done",
    label: "Task done",
    description: "Accepted result is closed; follow-up work can start from it.",
    severity: "success",
    primaryAction: "ask_follow_up",
    nextActionLabel: "Ask a follow-up or create a next task",
    secondaryActions: ["review_result"],
  },
  cancelled: {
    state: "cancelled",
    label: "Cancelled",
    description: "Work was cancelled before completion.",
    severity: "neutral",
    primaryAction: "review_result",
    nextActionLabel: "Inspect the audit trail or reopen the task",
    secondaryActions: ["reopen"],
  },
};

function normalizeState(value: string | null | undefined): WorkItemUserState | null {
  if (!value) return null;
  const key = value.replace(/[\s-]/g, "_").replace(/_/g, "").toLowerCase();
  const underscoreKey = value.replace(/[\s-]/g, "_").toLowerCase();
  return NORMALIZED[underscoreKey] ?? NORMALIZED[key] ?? null;
}

function pickState(input: DeriveWorkItemStateViewInput): WorkItemUserState {
  const nodeState = normalizeState(input.nodeStatus);
  const executionState = normalizeState(input.executionStatus);
  const taskState = normalizeState(input.taskStatus);
  const terminalState = [taskState, executionState]
    .find((state) => state ? TERMINAL_WORK_ITEM_STATES.has(state) : false) ?? null;
  if (terminalState) return terminalState;
  const providerState = normalizeState(input.providerStatus);

  const candidates = [
    nodeState,
    executionState,
    providerState,
    taskState,
    normalizeState(input.planStatus),
    normalizeState(input.scheduleStatus),
  ].filter((state): state is WorkItemUserState => Boolean(state));

  if (input.isRunnable === false) candidates.push("blocked");
  if (input.hasPlan === false && input.planStatus == null) candidates.push("ready_to_plan");
  if (input.isScheduled === true) candidates.push("scheduled");
  if (input.isScheduled === false) candidates.push("unscheduled");

  for (const state of PRIORITY) {
    if (candidates.includes(state)) return state;
  }
  return "unscheduled";
}

export function deriveWorkItemStateView(input: DeriveWorkItemStateViewInput): WorkItemStateView {
  const state = pickState(input);
  const base = PRESENTATION[state];
  const disabledReason = input.disabledReason?.trim() || undefined;

  return {
    ...base,
    primaryAction: disabledReason ? null : base.primaryAction,
    disabledReason,
    source: {
      taskStatus: input.taskStatus ?? null,
      scheduleStatus: input.scheduleStatus ?? null,
      planStatus: input.planStatus ?? null,
      executionStatus: input.executionStatus ?? null,
      providerStatus: input.providerStatus ?? null,
      nodeStatus: input.nodeStatus ?? null,
    },
  };
}

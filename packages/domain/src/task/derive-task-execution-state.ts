import type { TaskExecutionState } from "@chrona/contracts";

type TaskBlockReason = {
  blockType?: string | null;
  actionRequired?: string | null;
  scope?: string | null;
  nodeId?: string | null;
};

type TaskExecutionGraphInput = {
  nodes: Array<{ status: string }>;
  readyNodeIds: string[];
  runningNodeIds: string[];
  completedNodeIds: string[];
  failedNodeIds: string[];
  blockedNodeIds: string[];
  degradedNodeIds: string[];
  waitingNodeIds: string[];
  waitingForUserNodeIds: string[];
  waitingForApprovalNodeIds: string[];
  cancelledNodeIds: string[];
};

export type TaskExecutionStateInput = {
  graph?: TaskExecutionGraphInput | null;
  blockReason?: TaskBlockReason | null;
  taskStatus?: string | null;
  runStatus?: string | null;
  executionSessionStatus?: string | null;
};

const TERMINAL_TASK_STATUSES = new Set(["Completed", "Done", "Cancelled"]);
const TERMINAL_GRAPH_NODE_STATUSES = new Set(["completed", "skipped", "invalidated", "cancelled"]);
const BLOCK_TYPE_EXECUTION_STATES = new Map<string, TaskExecutionState>([
  ["human_input_required", "waiting_for_user"],
  ["waiting_for_input", "waiting_for_user"],
  ["approval_required", "waiting_for_approval"],
  ["approval_pending", "waiting_for_approval"],
  ["replan_required", "waiting_for_approval"],
  ["run_failed", "failed"],
  ["node_failed", "failed"],
]);

const TASK_STATUS_EXECUTION_STATES = new Map<string, TaskExecutionState>([
  ["waitingforinput", "waiting_for_user"],
  ["waiting_for_input", "waiting_for_user"],
  ["waitingforapproval", "waiting_for_approval"],
  ["waiting_for_approval", "waiting_for_approval"],
  ["blocked", "blocked"],
  ["failed", "failed"],
]);

const RUN_STATUS_EXECUTION_STATES = new Map<string, TaskExecutionState>([
  ["Pending", "queued"],
  ["Running", "running"],
  ["WaitingForInput", "waiting_for_user"],
  ["WaitingForApproval", "waiting_for_approval"],
  ["Failed", "failed"],
  ["Completed", "completed"],
  ["Cancelled", "cancelled"],
]);

const EXECUTION_STATE_RUN_LABELS = new Map<TaskExecutionState, string>([
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["failed", "Failed"],
  ["waiting_for_user", "WaitingForInput"],
  ["waiting_for_approval", "WaitingForApproval"],
  ["running", "Running"],
  ["queued", "Pending"],
]);

type GraphStateRule = {
  state: TaskExecutionState;
  matches: (graph: TaskExecutionGraphInput) => boolean;
};

const GRAPH_STATE_RULES: GraphStateRule[] = [
  { state: "failed", matches: (graph) => graph.failedNodeIds.length > 0 },
  { state: "degraded", matches: (graph) => graph.degradedNodeIds.length > 0 },
  { state: "blocked", matches: (graph) => graph.blockedNodeIds.length > 0 },
  { state: "waiting_for_approval", matches: (graph) => graph.waitingForApprovalNodeIds.length > 0 },
  { state: "waiting_for_user", matches: (graph) => graph.waitingForUserNodeIds.length > 0 || graph.waitingNodeIds.length > 0 },
  { state: "running", matches: (graph) => graph.runningNodeIds.length > 0 },
];

function queuedGraphExecutionState(graph: TaskExecutionGraphInput): TaskExecutionState | null {
  return graph.readyNodeIds.length > 0 ? "queued" : null;
}



function firstGraphExecutionState(graph: TaskExecutionGraphInput): TaskExecutionState | null {
  const attentionState = GRAPH_STATE_RULES.find((rule) => rule.matches(graph))?.state;
  if (attentionState) return attentionState;

  if (graph.nodes.length > 0 && graph.nodes.every((node) => TERMINAL_GRAPH_NODE_STATUSES.has(node.status))) {
    return graph.cancelledNodeIds.length > 0 && graph.completedNodeIds.length === 0 ? "cancelled" : "completed";
  }

  return graph.cancelledNodeIds.length > 0 && graph.readyNodeIds.length === 0 ? "cancelled" : null;
}


export function deriveTaskExecutionState(input: TaskExecutionStateInput): TaskExecutionState {
  const graph = input.graph ?? null;
  const taskStatus = input.taskStatus ?? null;
  const graphState = graph ? firstGraphExecutionState(graph) : null;
  if (graphState) return graphState;

  if (input.executionSessionStatus === "Completed") return "completed";
  if (input.executionSessionStatus === "Abandoned") return "cancelled";

  const blockState = executionStateFromTaskBlock(input.blockReason, taskStatus);
  if (blockState) return blockState;

  if (taskStatus && TERMINAL_TASK_STATUSES.has(taskStatus)) {
    if (taskStatus === "Cancelled") return "cancelled";
    return "completed";
  }

  const runState = executionStateFromRunStatus(input.runStatus);

  const queuedState = graph ? queuedGraphExecutionState(graph) : null;
  if (queuedState) return queuedState;
  if (runState) return runState;

  return "not_started";
}

function executionStateFromTaskBlock(
  blockReason?: TaskBlockReason | null,
  taskStatus?: string | null,
): TaskExecutionState | null {
  if (taskStatus === "Completed" || taskStatus === "Done") return null;

  const blockType = blockReason?.blockType?.trim().toLowerCase() ?? "";
  if (blockType) return BLOCK_TYPE_EXECUTION_STATES.get(blockType) ?? "blocked";

  return taskStatus ? TASK_STATUS_EXECUTION_STATES.get(taskStatus.toLowerCase()) ?? null : null;
}

function executionStateFromRunStatus(runStatus?: string | null): TaskExecutionState | null {
  return runStatus ? RUN_STATUS_EXECUTION_STATES.get(runStatus) ?? null : null;
}

export function taskExecutionStateToRunStatus(state: TaskExecutionState): string {
  const label = EXECUTION_STATE_RUN_LABELS.get(state);
  if (label) return label;

  return state
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

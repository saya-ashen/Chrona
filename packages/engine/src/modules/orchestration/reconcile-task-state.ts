import type {
  GraphNodeState,
  ReconciliationResult,
  TaskAction,
  TaskExecutionState,
  TaskExecutionSummary,
  TaskNodeState,
} from "@chrona/contracts";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/graph-runtime";
import { deriveRepairActions, detectReconciliationIssues } from "./reconcile-invariants";

type ReconcileTaskStateInput = {
  taskId: string;
  graph: EffectivePlanGraph;
  runnable?: boolean;
  readinessReason?: string | null;
  taskStatus?: string | null;
  blockReason?: TaskBlockReason | null;
  now?: Date;
};

type TaskBlockReason = {
  blockType?: string | null;
  actionRequired?: string | null;
  scope?: string | null;
  nodeId?: string | null;
};

export type ReconciledTaskState = {
  summary: TaskExecutionSummary;
  nodes: GraphNodeState[];
  reconciliation: ReconciliationResult;
};

const noAction: TaskAction = { type: "none", enabled: false, label: "No action available" };

export function reconcileTaskState(input: ReconcileTaskStateInput): ReconciledTaskState {
  const currentNode = pickCurrentNode(input.graph, input.blockReason);
  const executionState = deriveExecutionState(input.graph, input.blockReason, input.taskStatus);
  const progress = deriveProgress(input.graph);
  const primaryAction = derivePrimaryAction({
    state: executionState,
    runnable: input.runnable ?? true,
    blockReason: input.blockReason,
    targetNodeId: currentNode?.id ?? input.blockReason?.nodeId ?? null,
  });
  const issues = detectReconciliationIssues(input.graph);
  const repairActions = deriveRepairActions(issues);

  const summary: TaskExecutionSummary = {
    taskId: input.taskId,
    executionState,
    stateLabel: formatStateLabel(executionState),
    stateReason: currentNode?.blockedReason ?? currentNode?.lastError ?? null,
    graphVersion: input.graph.resolvedVersion,
    currentNodeId: currentNode?.id ?? null,
    primaryAction,
    progress,
    readiness: {
      runnable: input.runnable ?? true,
      reason: input.readinessReason ?? null,
    },
    degraded: firstDegradedReason(input.graph),
    blocking: firstReason(input.graph, input.graph.blockedNodeIds),
    waiting: firstReason(input.graph, input.graph.waitingNodeIds),
    recoveryActions: repairActions,
  };

  return {
    summary,
    nodes: input.graph.nodes.map((node) => toGraphNodeState(node, currentNode?.id ?? null)),
    reconciliation: {
      taskId: input.taskId,
      graphVersion: input.graph.resolvedVersion,
      executionState,
      currentNodeId: currentNode?.id ?? null,
      primaryAction,
      progress,
      issues,
      repairActions,
      createdAt: (input.now ?? new Date()).toISOString(),
    },
  };
}

function deriveExecutionState(
  graph: EffectivePlanGraph,
  blockReason?: TaskBlockReason | null,
  taskStatus?: string | null,
): TaskExecutionState {
  if (graph.failedNodeIds.length > 0) return "failed";
  if (graph.degradedNodeIds.length > 0) return "degraded";
  if (graph.blockedNodeIds.length > 0) return "blocked";
  if (graph.waitingForApprovalNodeIds.length > 0) return "waiting_for_approval";
  if (graph.waitingForUserNodeIds.length > 0 || graph.waitingNodeIds.length > 0) return "waiting_for_user";
  const blockState = executionStateFromTaskBlock(blockReason, taskStatus);
  if (blockState) return blockState;
  if (graph.runningNodeIds.length > 0) return "running";
  if (graph.cancelledNodeIds.length > 0 && graph.readyNodeIds.length === 0) return "cancelled";
  if (graph.readyNodeIds.length > 0) return "queued";
  if (graph.nodes.length > 0 && graph.nodes.every((node) => isTerminalStatus(node.status))) return "completed";
  return "not_started";
}

function pickCurrentNode(graph: EffectivePlanGraph, blockReason?: TaskBlockReason | null) {
  const currentId = [
    blockReason?.nodeId,
    ...graph.runningNodeIds,
    ...graph.waitingForApprovalNodeIds,
    ...graph.waitingForUserNodeIds,
    ...graph.waitingNodeIds,
    ...graph.blockedNodeIds,
    ...graph.degradedNodeIds,
    ...graph.failedNodeIds,
    ...graph.readyNodeIds,
  ].find((nodeId): nodeId is string => Boolean(nodeId));
  return currentId ? graph.nodes.find((node) => node.id === currentId) ?? null : null;
}

function derivePrimaryAction(input: {
  state: TaskExecutionState;
  runnable: boolean;
  blockReason?: TaskBlockReason | null;
  targetNodeId?: string | null;
}): TaskAction {
  const blockAction = derivePrimaryActionFromTaskBlock(input.blockReason, input.targetNodeId);
  if (blockAction) return input.runnable ? blockAction : { ...blockAction, enabled: false, label: "Not runnable" };
  const { state, runnable } = input;
  if (!runnable) return { type: "none", enabled: false, label: "Not runnable" };
  switch (state) {
    case "not_started":
    case "scheduled":
    case "queued":
      return { type: "start", enabled: true, label: "Start task" };
    case "waiting_for_user":
      return { type: "provide_input", enabled: true, label: "Provide input" };
    case "waiting_for_approval":
      return { type: "approve", enabled: true, label: "Review approval" };
    case "failed":
    case "degraded":
      return { type: "retry_sync", enabled: true, label: "Retry sync" };
    case "blocked":
      return { type: "replan", enabled: true, label: "Replan" };
    default:
      return noAction;
  }
}

function executionStateFromTaskBlock(
  blockReason?: TaskBlockReason | null,
  taskStatus?: string | null,
): TaskExecutionState | null {
  if (taskStatus === "Completed" || taskStatus === "Done") return null;

  const blockType = normalizeBlockType(blockReason);
  if (blockType === "human_input_required" || blockType === "waiting_for_input") return "waiting_for_user";
  if (blockType === "approval_required" || blockType === "approval_pending") return "waiting_for_approval";
  if (blockType === "replan_required") return "waiting_for_approval";
  if (blockType === "run_failed" || blockType === "node_failed") return "failed";
  if (blockType) return "blocked";

  switch (taskStatus?.toLowerCase()) {
    case "waitingforinput":
    case "waiting_for_input":
      return "waiting_for_user";
    case "waitingforapproval":
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

function derivePrimaryActionFromTaskBlock(
  blockReason?: TaskBlockReason | null,
  targetNodeId?: string | null,
): TaskAction | null {
  const blockType = normalizeBlockType(blockReason);
  const actionRequired = blockReason?.actionRequired?.trim();
  switch (blockType) {
    case "human_input_required":
    case "waiting_for_input":
      return { type: "provide_input", enabled: true, label: actionRequired || "Provide input", targetNodeId };
    case "approval_required":
    case "approval_pending":
      return { type: "approve", enabled: true, label: actionRequired || "Review approval", targetNodeId };
    case "replan_required":
      return { type: "replan", enabled: true, label: actionRequired || "Replan", targetNodeId };
    case "run_failed":
    case "node_failed":
      return { type: "retry_sync", enabled: true, label: actionRequired || "Retry run", targetNodeId };
    case "external_dependency":
      return { type: "resume", enabled: true, label: actionRequired || "Resume after unblock", targetNodeId };
    case "capability_unavailable":
      return { type: "retry_sync", enabled: true, label: actionRequired || "Retry after provider is available", targetNodeId };
    case "node_blocked":
      return { type: "replan", enabled: true, label: actionRequired || "Resolve blocked node", targetNodeId };
    default:
      return null;
  }
}

function normalizeBlockType(blockReason?: TaskBlockReason | null) {
  return blockReason?.blockType?.trim().toLowerCase() ?? "";
}

function deriveProgress(graph: EffectivePlanGraph) {
  const total = graph.nodes.filter((node) => node.reachable).length;
  const completed = graph.nodes.filter(
    (node) => node.reachable && (node.status === "completed" || node.status === "skipped"),
  ).length;
  return {
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function toGraphNodeState(node: EffectivePlanNode, currentNodeId: string | null): GraphNodeState {
  const status = toTaskNodeState(node.status);

  return {
    id: node.id,
    type: node.type,
    status,
    reachable: node.reachable,
    current: node.id === currentNodeId,
    requiresAction: node.status.startsWith("waiting_") || node.status === "blocked" || node.status === "failed" || node.status === "degraded",
    result: node.result ?? null,
    stateReason: node.blockedReason ?? node.lastError ?? null,
    invalidatedByMutationId: null,
  };
}

function toTaskNodeState(status: EffectivePlanNode["status"]): TaskNodeState {
  return status === "degraded" || status === "waiting" ? "blocked" : status;
}

function firstDegradedReason(graph: EffectivePlanGraph) {
  const reason = firstReason(graph, graph.degradedNodeIds);
  return reason ? { reason: reason.reason, retryAt: null } : null;
}

function firstReason(graph: EffectivePlanGraph, nodeIds: string[]) {
  const nodeId = nodeIds[0];
  if (!nodeId) return null;
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  return {
    reason: node?.blockedReason ?? node?.lastError ?? node?.title ?? "Action required",
    nodeId,
  };
}

function isTerminalStatus(status: EffectivePlanNode["status"]) {
  return status === "completed" || status === "skipped" || status === "invalidated" || status === "cancelled";
}

function formatStateLabel(state: TaskExecutionState) {
  return state
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

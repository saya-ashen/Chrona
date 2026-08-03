import {
  projectPublicEffectivePlanGraph,
  type GraphNodeState,
  type PublicEffectivePlanGraph,
  type PublicEffectivePlanNode,
  type ReconciliationResult,
  type TaskAction,
  type TaskExecutionState,
  type TaskExecutionSummary,
  type TaskNodeState,
} from "@chrona/contracts";
import type { EffectivePlanGraph } from "@chrona/graph-runtime";
import { deriveTaskExecutionState } from "@chrona/domain";
import { deriveRepairActions, detectReconciliationIssues } from "./reconcile-invariants";

type ReconcileTaskStateInput = {
  taskId: string;
  graph: EffectivePlanGraph | PublicEffectivePlanGraph;
  runnable?: boolean;
  readinessReason?: string | null;
  taskStatus?: string | null;
  blockReason?: TaskBlockReason | null;
  now?: Date;
  hasActiveRun?: boolean;
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
  const graph = toPublicReconciliationGraph(input.graph);
  const currentNode = pickCurrentNode(graph, input.blockReason);
  const executionState = deriveExecutionState(graph, input.blockReason, input.taskStatus, input.hasActiveRun);
  const progress = deriveProgress(graph);
  const issues = detectReconciliationIssues(graph);
  const repairActions = deriveRepairActions(issues);
  const primaryAction = derivePrimaryAction({
    state: executionState,
    runnable: input.runnable ?? true,
    blockReason: input.blockReason,
    targetNodeId: currentNode?.id ?? input.blockReason?.nodeId ?? null,
  });

  const summary: TaskExecutionSummary = {
    taskId: input.taskId,
    executionState,
    stateLabel: formatStateLabel(executionState),
    stateReason: nodeStateReason(currentNode),
    graphVersion: graph.resolvedVersion,
    currentNodeId: currentNode?.id ?? null,
    primaryAction,
    progress,
    readiness: {
      runnable: input.runnable ?? true,
      reason: input.readinessReason ?? null,
    },
    degraded: firstDegradedReason(graph),
    blocking: firstReason(graph, graph.blockedNodeIds),
    waiting: firstReason(graph, graph.waitingNodeIds),
    recoveryActions: repairActions,
  };

  return {
    summary,
    nodes: graph.nodes.map((node) => toGraphNodeState(node, currentNode?.id ?? null)),
    reconciliation: {
      taskId: input.taskId,
      graphVersion: graph.resolvedVersion,
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
  graph: PublicEffectivePlanGraph,
  blockReason?: TaskBlockReason | null,
  taskStatus?: string | null,
  hasActiveRun?: boolean,
): TaskExecutionState {
  return deriveTaskExecutionState({ graph, blockReason, taskStatus, hasActiveRun });
}

function pickCurrentNode(graph: PublicEffectivePlanGraph, blockReason?: TaskBlockReason | null) {
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
  if (input.state === "completed" || input.state === "cancelled") return noAction;
  const { state, runnable } = input;
  if (!runnable) return { type: "none", enabled: false, label: "Not runnable" };
  if (state === "waiting_for_user") return { type: "provide_input", enabled: true, label: "Provide input", targetNodeId: input.targetNodeId };
  if (state === "waiting_for_approval") return { type: "approve", enabled: true, label: "Review approval", targetNodeId: input.targetNodeId };
  const blockAction = derivePrimaryActionFromTaskBlock(input.blockReason, input.targetNodeId);
  if (blockAction) return blockAction;
  switch (state) {
    case "not_started":
    case "scheduled":
    case "queued":
      return { type: "start", enabled: true, label: "Start task" };
    case "failed":
    case "degraded":
      return { type: "retry_sync", enabled: true, label: "Retry sync" };
    case "blocked":
      return { type: "replan", enabled: true, label: "Replan" };
    case "running":
      return noAction;
    default:
      return noAction;
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
    case "sync_stale":
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

function deriveProgress(graph: PublicEffectivePlanGraph) {
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

function toGraphNodeState(node: PublicEffectivePlanNode, currentNodeId: string | null): GraphNodeState {
  const status = toTaskNodeState(node.status);

  return {
    id: node.id,
    type: node.type,
    status,
    reachable: node.reachable,
    current: node.id === currentNodeId,
    requiresAction: node.status.startsWith("waiting_") || node.status === "blocked" || node.status === "failed" || node.status === "degraded",
    result: node.result ?? null,
    stateReason: nodeStateReason(node),
    invalidatedByMutationId: null,
  };
}

function toTaskNodeState(status: PublicEffectivePlanNode["status"]): TaskNodeState {
  return status === "degraded" || status === "waiting" ? "blocked" : status;
}

function firstDegradedReason(graph: PublicEffectivePlanGraph) {
  const reason = firstReason(graph, graph.degradedNodeIds);
  return reason ? { reason: reason.reason, retryAt: null } : null;
}

function firstReason(graph: PublicEffectivePlanGraph, nodeIds: string[]) {
  const nodeId = nodeIds[0];
  if (!nodeId) return null;
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  return {
    reason: nodeStateReason(node) ?? node?.title ?? "Action required",
    nodeId,
  };
}

function nodeStateReason(node: PublicEffectivePlanNode | null | undefined) {
  return node?.blockedReason
    ?? (node?.status === "failed" ? "Node execution failed." : null);
}

function toPublicReconciliationGraph(
  graph: EffectivePlanGraph | PublicEffectivePlanGraph,
): PublicEffectivePlanGraph {
  return isInternalEffectivePlanGraph(graph)
    ? projectPublicEffectivePlanGraph(graph)
    : graph;
}

function isInternalEffectivePlanGraph(
  graph: EffectivePlanGraph | PublicEffectivePlanGraph,
): graph is EffectivePlanGraph {
  return Object.prototype.hasOwnProperty.call(graph, "activeLayerId");
}


function formatStateLabel(state: TaskExecutionState) {
  return state
    .split("_")
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

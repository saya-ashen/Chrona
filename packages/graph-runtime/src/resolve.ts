import type {
  EffectivePlanEdge,
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeLayer,
  NodeResult,
  PlanNode,
  ResolveEffectivePlanGraphInput,
  WaitKind,
} from "./types";
import type { NodeAttempt } from "./types";

export function resolveEffectivePlanGraph(
  input: ResolveEffectivePlanGraphInput,
): EffectivePlanGraph;
export function resolveEffectivePlanGraph(
  input: ResolveEffectivePlanGraphInput,
): EffectivePlanGraph {
  const { graph, attempts = [], results = [] } = input;
  const edgeMap = new Map<string, EffectivePlanEdge>();
  const nodeMap = new Map<string, EffectivePlanNode>();

  for (const edge of graph.edges) {
    edgeMap.set(edge.id, {
      id: edge.id,
      from: edge.fromNodeId,
      to: edge.toNodeId,
      label: edge.label,
      active: edge.active,
    });
  }

  for (const node of graph.nodes) {
    const effectiveNode = buildEffectiveNodeFromGraphNode(node, attempts, results);
    if (effectiveNode) {
      nodeMap.set(node.id, effectiveNode);
    }
  }

  applyConditionBranchSelections(nodeMap, edgeMap);
  const entryNodeIds = computeGraphEntryNodeIds(nodeMap, edgeMap);
  const reachableNodeIds = computeReachableNodeIds(entryNodeIds, edgeMap);
  markUnreachableNodesSkipped(nodeMap, reachableNodeIds);
  rebuildDependencies(nodeMap, edgeMap, reachableNodeIds);

  return buildEffectiveGraphSummary({
    graphId: graph.id,
    basePlanId: graph.id,
    resolvedVersion: graph.mutations.length,
    nodeMap,
    edgeMap,
    entryNodeIds,
    reachableNodeIds,
  });
}

function buildEffectiveGraphSummary(input: {
  graphId: string;
  basePlanId: string;
  resolvedVersion: number;
  nodeMap: Map<string, EffectivePlanNode>;
  edgeMap: Map<string, EffectivePlanEdge>;
  entryNodeIds: string[];
  reachableNodeIds: Set<string>;
}): EffectivePlanGraph {
  const terminalNodeIds: string[] = [];
  const readyNodeIds: string[] = [];
  const blockedNodeIds: string[] = [];
  const waitingNodeIds: string[] = [];
  const waitingForUserNodeIds: string[] = [];
  const waitingForApprovalNodeIds: string[] = [];
  const degradedNodeIds: string[] = [];
  const skippedNodeIds: string[] = [];
  const cancelledNodeIds: string[] = [];
  const completedNodeIds: string[] = [];
  const runningNodeIds: string[] = [];
  const invalidatedNodeIds: string[] = [];
  const failedNodeIds: string[] = [];
  const pendingNodeIds: string[] = [];

  for (const [nodeId, node] of input.nodeMap) {
    const hasOutgoingEdges = [...input.edgeMap.values()].some(
      (edge) => edge.active && edge.from === nodeId,
    );
    node.reachable = input.reachableNodeIds.has(nodeId);

    if (node.reachable && !hasOutgoingEdges) {
      terminalNodeIds.push(nodeId);
    }

    const allDepsSatisfied = node.dependencies.every((depId) => {
      const dep = input.nodeMap.get(depId);
      return (
        dep?.status === "completed" ||
        dep?.status === "skipped" ||
        dep?.status === "invalidated"
      );
    });

    node.dependenciesSatisfied = allDepsSatisfied;
    node.ready =
      node.reachable &&
      allDepsSatisfied &&
      (node.status === "pending" || node.status === "ready");

    if (node.ready) {
      node.status = "ready";
      readyNodeIds.push(nodeId);
    }

    switch (node.status) {
      case "completed":
        completedNodeIds.push(nodeId);
        break;
      case "skipped":
        skippedNodeIds.push(nodeId);
        completedNodeIds.push(nodeId);
        break;
      case "running":
        runningNodeIds.push(nodeId);
        break;
      case "degraded":
        degradedNodeIds.push(nodeId);
        break;
      case "invalidated":
        invalidatedNodeIds.push(nodeId);
        break;
      case "waiting":
        waitingNodeIds.push(nodeId);
        break;
      case "waiting_for_user":
        waitingNodeIds.push(nodeId);
        waitingForUserNodeIds.push(nodeId);
        break;
      case "waiting_for_approval":
        waitingNodeIds.push(nodeId);
        waitingForApprovalNodeIds.push(nodeId);
        break;
      case "blocked":
        blockedNodeIds.push(nodeId);
        break;
      case "failed":
        failedNodeIds.push(nodeId);
        break;
      case "cancelled":
        cancelledNodeIds.push(nodeId);
        break;
      default:
        if (!node.ready) {
          pendingNodeIds.push(nodeId);
        }
        break;
    }
  }

  return {
    graphId: input.graphId,
    basePlanId: input.basePlanId,
    resolvedAt: new Date().toISOString(),
    resolvedVersion: input.resolvedVersion,
    nodes: [...input.nodeMap.values()],
    edges: [...input.edgeMap.values()],
    entryNodeIds: input.entryNodeIds,
    terminalNodeIds,
    readyNodeIds,
    blockedNodeIds,
    waitingNodeIds,
    waitingForUserNodeIds,
    waitingForApprovalNodeIds,
    degradedNodeIds,
    skippedNodeIds,
    cancelledNodeIds,
    completedNodeIds,
    runningNodeIds,
    invalidatedNodeIds,
    failedNodeIds,
    pendingNodeIds,
  };
}

function markUnreachableNodesSkipped(
  nodeMap: Map<string, EffectivePlanNode>,
  reachableNodeIds: Set<string>,
): void {
  for (const [nodeId, node] of nodeMap) {
    if (reachableNodeIds.has(nodeId)) continue;
    if (node.status === "pending" || node.status === "ready") {
      node.status = "skipped";
    }
  }
}

function buildEffectiveNodeFromGraphNode(
  node: PlanNode,
  attempts: NodeAttempt[],
  results: NodeResult[],
): EffectivePlanNode | null {
  const activeDefinitionLayer = getActiveDefinitionLayer(node.layers);
  if (!activeDefinitionLayer) {
    return null;
  }

  const latestInvalidation = getLatestLayer(node.layers, "invalidation");
  const latestCancellation = getLatestLayer(node.layers, "cancellation");
  const nodeResults = results.filter((result) => result.nodeId === node.id);
  const currentResult =
    nodeResults.find(
      (result) =>
        result.nodeLayerId === activeDefinitionLayer.id &&
        result.status === "current",
    ) ??
    [...nodeResults]
      .filter((result) => result.nodeLayerId === activeDefinitionLayer.id)
      .at(-1);
  const activeAttempt = [...attempts]
    .filter(
      (attempt) =>
        attempt.nodeId === node.id && attempt.nodeLayerId === activeDefinitionLayer.id,
    )
    .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
  const semantics = activeDefinitionLayer.definition.semantics;
  const status = deriveNodeStatus({
    invalidated: Boolean(latestInvalidation),
    cancelled: Boolean(latestCancellation),
    activeAttempt,
    result: currentResult,
  });

  return {
    id: node.id,
    nodeId: node.id,
    activeLayerId: activeDefinitionLayer.id,
    semanticKey: node.semanticKey,
    definition: activeDefinitionLayer.definition,
    invalidated: Boolean(latestInvalidation),
    invalidationReason: latestInvalidation?.reason,
    waitKind: currentResult?.waitKind,
    reviewRequired: activeDefinitionLayer.definition.reviewRequired ?? false,
    localId: node.semanticKey,
    type: semantics.type,
    title: activeDefinitionLayer.definition.title,
    description: activeDefinitionLayer.definition.description,
    priority: semantics.priority,
    linkedTaskId: semantics.linkedTaskId,
    config: (activeDefinitionLayer.definition.metadata ?? {}) as EffectivePlanNode["config"],
    executor: activeDefinitionLayer.definition.executor,
    mode: semantics.mode,
    estimatedMinutes: activeDefinitionLayer.definition.estimatedMinutes,
    dependencies: [],
    dependents: [],
    status,
    attempts: activeAttempt?.attemptNumber ?? 0,
    lastError: currentResult?.error ?? activeAttempt?.error?.message,
    startedAt: activeAttempt?.startedAt,
    completedAt: activeAttempt?.finishedAt,
    result: currentResult,
    blockedReason: currentResult?.error ?? currentResult?.outputSummary ?? latestInvalidation?.reason,
    metadata: {
      ...(semantics.metadata ?? {}),
      ...(activeDefinitionLayer.definition.metadata ?? {}),
    },
    dependenciesSatisfied: false,
    ready: false,
    reachable: true,
  };
}

function getActiveDefinitionLayer(layers: NodeLayer[]) {
  return [...layers]
    .reverse()
    .find((layer): layer is Extract<NodeLayer, { type: "definition" }> => layer.type === "definition");
}

function getLatestLayer<TType extends NodeLayer["type"]>(
  layers: NodeLayer[],
  type: TType,
): Extract<NodeLayer, { type: TType }> | undefined {
  return [...layers]
    .reverse()
    .find((layer): layer is Extract<NodeLayer, { type: TType }> => layer.type === type);
}

function deriveNodeStatus(input: {
  invalidated: boolean;
  cancelled: boolean;
  activeAttempt?: NodeAttempt;
  result?: NodeResult;
}): EffectivePlanNode["status"] {
  if (input.invalidated || input.result?.status === "invalidated") {
    return "invalidated";
  }
  if (input.cancelled) {
    return "cancelled";
  }
  if (input.activeAttempt?.status === "running") {
    return "running";
  }
  if (input.result?.waitKind) {
    return mapWaitKindToNodeStatus(input.result.waitKind);
  }
  if (input.result?.status === "rejected" && input.result.errorDetails === "degraded") {
    return "degraded";
  }
  if (
    input.result?.outputSummary !== undefined ||
    input.result?.checkpointResponse !== undefined ||
    input.result?.artifactRefs?.length ||
    input.result?.selectedBranch !== undefined ||
    input.result?.status === "current" ||
    input.activeAttempt?.status === "succeeded"
  ) {
    return "completed";
  }
  if (input.result?.status === "rejected" || input.activeAttempt?.status === "failed") {
    return "failed";
  }
  return "pending";
}

function mapWaitKindToNodeStatus(waitKind: WaitKind): EffectivePlanNode["status"] {
  switch (waitKind) {
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
      return "waiting_for_approval";
    default:
      return "waiting";
  }
}

function computeGraphEntryNodeIds(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
): string[] {
  const entryNodeIds: string[] = [];
  for (const nodeId of nodeMap.keys()) {
    const hasIncomingEdges = [...edgeMap.values()].some(
      (edge) => edge.to === nodeId,
    );
    if (!hasIncomingEdges) {
      entryNodeIds.push(nodeId);
    }
  }
  return entryNodeIds;
}

function rebuildDependencies(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
  reachableNodeIds: Set<string>,
): void {
  for (const node of nodeMap.values()) {
    node.dependencies = [];
    node.dependents = [];
  }

  for (const edge of edgeMap.values()) {
    if (!edge.active) continue;
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (!reachableNodeIds.has(edge.from) || !reachableNodeIds.has(edge.to)) continue;

    if (!fromNode.dependents.includes(edge.to)) {
      fromNode.dependents.push(edge.to);
    }
    if (!toNode.dependencies.includes(edge.from)) {
      toNode.dependencies.push(edge.from);
    }
  }
}

function applyConditionBranchSelections(
  nodeMap: Map<string, EffectivePlanNode>,
  edgeMap: Map<string, EffectivePlanEdge>,
) {
  for (const node of nodeMap.values()) {
    if (node.type !== "condition") continue;
    const selectedNextNodeId = node.result?.selectedBranch?.nextNodeId;
    if (!selectedNextNodeId) continue;

    for (const edge of edgeMap.values()) {
      if (edge.from !== node.id) continue;
      edge.active = edge.to === selectedNextNodeId;
    }
  }
}

function computeReachableNodeIds(
  entryNodeIds: string[],
  edgeMap: Map<string, EffectivePlanEdge>,
) {
  const adjacency = new Map<string, string[]>();
  for (const edge of edgeMap.values()) {
    if (!edge.active) continue;
    const next = adjacency.get(edge.from) ?? [];
    next.push(edge.to);
    adjacency.set(edge.from, next);
  }

  const reachable = new Set<string>();
  const queue = [...entryNodeIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }

  return reachable;
}

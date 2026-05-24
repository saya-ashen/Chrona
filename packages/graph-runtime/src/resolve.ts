import type {
  EffectivePlanEdge,
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeLayer,
  NodeDefinition,
  NodeResult,
  PlanEdge,
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

  applyConditionBranchSelections(nodeMap, edgeMap, graph.edges);
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
    const graphHasRunningNode = [...input.nodeMap.values()].some(
      (candidate) => candidate.status === "running",
    );
    node.ready =
      node.reachable &&
      !graphHasRunningNode &&
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
  const nodeResults = results.filter(
    (result) => result.nodeId === node.id && !isFailedSubmissionNodeResult(result),
  );
  const currentResult =
    nodeResults.find(
      (result) =>
        result.nodeLayerId === activeDefinitionLayer.id &&
        result.status === "current",
    ) ??
    nodeResults.find(
      (result) =>
        result.nodeLayerId === activeDefinitionLayer.id &&
        result.status === "rejected" &&
        result.errorDetails === "degraded",
    ) ??
    nodeResults.find(
      (result) =>
        result.nodeLayerId === activeDefinitionLayer.id &&
        result.status === "rejected",
    );
  const activeAttempt = [...attempts]
    .filter(
      (attempt) =>
        attempt.nodeId === node.id && attempt.nodeLayerId === activeDefinitionLayer.id,
    )
    .sort(compareAttemptsForEffectiveState)[0];
  const definition = activeDefinitionLayer.definition;
  const semantics = definition.semantics;
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
    definition,
    invalidated: Boolean(latestInvalidation),
    invalidationReason: latestInvalidation?.reason,
    waitKind: currentResult?.waitKind,
    reviewRequired: definition.reviewRequired ?? false,
    localId: node.semanticKey,
    type: semantics.type,
    title: definition.title,
    description: definition.description,
    priority: semantics.priority,
    linkedTaskId: semantics.linkedTaskId,
    config: nodeConfigFromDefinition(definition),
    executor: definition.executor,
    mode: semantics.mode,
    estimatedMinutes: definition.estimatedMinutes,
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

function nodeConfigFromDefinition(definition: NodeDefinition): EffectivePlanNode["config"] {
  const directMetadata = isRecord(definition.metadata) ? definition.metadata : {};
  const semanticsMetadata = isRecord(definition.semantics.metadata) ? definition.semantics.metadata : {};
  const metadataConfig = isRecord(directMetadata.config) ? directMetadata.config : null;
  const semanticsConfig = isRecord(semanticsMetadata.config) ? semanticsMetadata.config : null;

  return (metadataConfig ?? semanticsConfig ?? directMetadata ?? semanticsMetadata) as EffectivePlanNode["config"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAILED_SUBMISSION_RESULT_PATTERNS = [
  /Chrona\s*(?:节点)?结果提交(?:被后端拒绝|失败)/i,
  /结果提交被后端拒绝/i,
  /terminal tool submission failed/i,
];

function isFailedSubmissionNodeResult(result: NodeResult): boolean {
  const text = [
    result.outputSummary,
    result.error,
    ...(result.outputs ?? []).map(nodeResultOutputText),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  return FAILED_SUBMISSION_RESULT_PATTERNS.some((pattern) => pattern.test(text));
}

function nodeResultOutputText(output: NonNullable<NodeResult["outputs"]>[number]): string | undefined {
  switch (output.kind) {
    case "text":
    case "markdown":
      return output.content;
    case "command":
      return [output.stdout, output.stderr].filter(Boolean).join("\n");
    case "json":
      return stringifyJsonOutput(output.value);
    default:
      return undefined;
  }
}

function stringifyJsonOutput(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function compareAttemptsForEffectiveState(a: NodeAttempt, b: NodeAttempt): number {
  const statusDelta = attemptStatusPriority(b.status) - attemptStatusPriority(a.status);
  if (statusDelta !== 0) return statusDelta;
  return b.attemptNumber - a.attemptNumber;
}

function attemptStatusPriority(status: NodeAttempt["status"]): number {
  switch (status) {
    case "running":
      return 4;
    case "succeeded":
      return 3;
    case "failed":
      return 2;
    case "cancelled":
      return 1;
  }
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
  if (input.result?.waitKind) {
    return mapWaitKindToNodeStatus(input.result.waitKind);
  }
  if (input.result?.status === "rejected" && input.result.errorDetails === "degraded") {
    return "degraded";
  }
  if (input.result?.status === "rejected") {
    return "failed";
  }
  if (input.activeAttempt?.status === "running") {
    return "running";
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
  if (input.activeAttempt?.status === "failed") {
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
    case "manual_action":
    case "capability_unavailable":
      return "blocked";
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
  graphEdges: PlanEdge[],
) {
  for (const node of nodeMap.values()) {
    if (node.type !== "condition") continue;
    if (node.status !== "completed") continue;
    const selectedNextNodeId = node.result?.selectedBranch?.nextNodeId;
    const branchEdgeIds = new Set(
      graphEdges
        .filter((edge) => edge.fromNodeId === node.id && edge.type === "branch")
        .map((edge) => edge.id),
    );
    const branchEdges = [...edgeMap.values()].filter((edge) => branchEdgeIds.has(edge.id));
    if (branchEdges.length === 0) continue;

    for (const edge of branchEdges) {
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

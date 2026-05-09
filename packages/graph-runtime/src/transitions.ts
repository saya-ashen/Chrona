import type {
  DependencyTraversalOptions,
  DependencyTraversalResult,
  EdgeSemantics,
  EdgeSemanticsResolution,
  EdgeType,
  EffectivePlanGraph,
  PlanEdge,
  PlanGraph,
  ReadyNodeSelection,
  ReadyNodeSelectionOptions,
  StructuralChangeImpact,
  StructuralChangeImpactInput,
} from "./types";

const DEFAULT_TRAVERSAL_EDGE_TYPES: EdgeType[] = [
  "hard_dependency",
  "ordering",
  "branch",
  "review_gate",
];

export function resolveEdgeSemantics(edge: Pick<PlanEdge, "type">): EdgeSemantics {
  switch (edge.type) {
    case "hard_dependency":
      return {
        type: edge.type,
        blocksReadiness: true,
        propagatesInvalidation: true,
        contributesContext: true,
        selectsBranch: false,
      };
    case "ordering":
      return {
        type: edge.type,
        blocksReadiness: true,
        propagatesInvalidation: false,
        contributesContext: false,
        selectsBranch: false,
      };
    case "context":
      return {
        type: edge.type,
        blocksReadiness: false,
        propagatesInvalidation: false,
        contributesContext: true,
        selectsBranch: false,
      };
    case "review_gate":
      return {
        type: edge.type,
        blocksReadiness: true,
        propagatesInvalidation: false,
        contributesContext: false,
        selectsBranch: false,
      };
    case "branch":
      return {
        type: edge.type,
        blocksReadiness: true,
        propagatesInvalidation: true,
        contributesContext: false,
        selectsBranch: true,
      };
  }
}

export function resolveGraphEdgeSemantics(graph: PlanGraph): EdgeSemanticsResolution[] {
  return graph.edges.map((edge) => ({ edge, semantics: resolveEdgeSemantics(edge) }));
}

export function traverseDependencies(
  graph: PlanGraph,
  startNodeIds: string[],
  options: DependencyTraversalOptions,
): DependencyTraversalResult {
  const edgeTypes = new Set(options.edgeTypes ?? DEFAULT_TRAVERSAL_EDGE_TYPES);
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const visitedNodeIds: string[] = [];
  const traversedEdgeIds: string[] = [];
  const seen = new Set(startNodeIds);
  const queue = startNodeIds.map((nodeId) => ({ nodeId, depth: 0 }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) continue;

    const edges = graph.edges.filter((edge) => {
      if (!options.includeInactiveEdges && !edge.active) return false;
      if (!edgeTypes.has(edge.type)) return false;
      return options.direction === "downstream"
        ? edge.fromNodeId === current.nodeId
        : edge.toNodeId === current.nodeId;
    });

    for (const edge of edges) {
      const nextNodeId = options.direction === "downstream" ? edge.toNodeId : edge.fromNodeId;
      traversedEdgeIds.push(edge.id);
      if (seen.has(nextNodeId)) continue;
      seen.add(nextNodeId);
      visitedNodeIds.push(nextNodeId);
      queue.push({ nodeId: nextNodeId, depth: current.depth + 1 });
    }
  }

  return { startNodeIds, visitedNodeIds, traversedEdgeIds };
}

export function getDownstreamNodeIds(
  graph: PlanGraph,
  nodeIds: string[],
  options: Omit<DependencyTraversalOptions, "direction"> = {},
): string[] {
  return traverseDependencies(graph, nodeIds, { ...options, direction: "downstream" })
    .visitedNodeIds;
}

export function getUpstreamNodeIds(
  graph: PlanGraph,
  nodeIds: string[],
  options: Omit<DependencyTraversalOptions, "direction"> = {},
): string[] {
  return traverseDependencies(graph, nodeIds, { ...options, direction: "upstream" })
    .visitedNodeIds;
}

export function selectReadyNodeIds(
  graph: EffectivePlanGraph,
  options: ReadyNodeSelectionOptions = {},
): ReadyNodeSelection {
  const selectedNodeIds: string[] = [];
  const maxNodes = options.maxNodes ?? Number.POSITIVE_INFINITY;

  for (const nodeId of graph.readyNodeIds) {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) continue;
    if (!options.includeManualNodes && node.mode === "manual") continue;
    if (!options.includeWaitingNodes && node.waitKind) continue;
    selectedNodeIds.push(nodeId);
    if (selectedNodeIds.length >= maxNodes) break;
  }

  return {
    graph,
    selectedNodeIds,
    blockedNodeIds: graph.blockedNodeIds,
  };
}

export function analyzeStructuralChangeImpact(
  input: StructuralChangeImpactInput,
): StructuralChangeImpact {
  const affectedNodeIds = new Set<string>();
  const addedNodeIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const changedEdgeIds = new Set<string>();
  const invalidationRootNodeIds = new Set<string>();

  for (const operation of input.operations) {
    switch (operation.type) {
      case "add_node":
        addedNodeIds.add(operation.nodeId);
        affectedNodeIds.add(operation.nodeId);
        break;
      case "push_node_layer":
        affectedNodeIds.add(operation.nodeId);
        invalidationRootNodeIds.add(operation.nodeId);
        break;
      case "delete_node":
        removedNodeIds.add(operation.nodeId);
        affectedNodeIds.add(operation.nodeId);
        invalidationRootNodeIds.add(operation.nodeId);
        break;
      case "replace_subgraph":
        for (const nodeId of operation.removeNodeIds) {
          removedNodeIds.add(nodeId);
          affectedNodeIds.add(nodeId);
          invalidationRootNodeIds.add(nodeId);
        }
        for (const node of operation.nodes) {
          addedNodeIds.add(node.nodeId);
          affectedNodeIds.add(node.nodeId);
        }
        for (const edge of operation.edges) {
          changedEdgeIds.add(edge.id);
          affectedNodeIds.add(edge.fromNodeId);
          affectedNodeIds.add(edge.toNodeId);
          invalidationRootNodeIds.add(edge.fromNodeId);
        }
        break;
      case "add_edge":
        changedEdgeIds.add(operation.edge.id);
        affectedNodeIds.add(operation.edge.fromNodeId);
        affectedNodeIds.add(operation.edge.toNodeId);
        invalidationRootNodeIds.add(operation.edge.fromNodeId);
        break;
      case "remove_edge": {
        changedEdgeIds.add(operation.edgeId);
        const edge = input.graph.edges.find((candidate) => candidate.id === operation.edgeId);
        if (edge) {
          affectedNodeIds.add(edge.fromNodeId);
          affectedNodeIds.add(edge.toNodeId);
          invalidationRootNodeIds.add(edge.fromNodeId);
        }
        break;
      }
      case "update_edge": {
        changedEdgeIds.add(operation.edgeId);
        const edge = input.graph.edges.find((candidate) => candidate.id === operation.edgeId);
        if (edge) {
          affectedNodeIds.add(edge.fromNodeId);
          affectedNodeIds.add(edge.toNodeId);
          invalidationRootNodeIds.add(edge.fromNodeId);
        }
        break;
      }
    }
  }

  const invalidationRoots = [...invalidationRootNodeIds].filter((nodeId) => !addedNodeIds.has(nodeId));
  return {
    affectedNodeIds: [...affectedNodeIds],
    invalidatedNodeIds: getDownstreamNodeIds(input.graph, invalidationRoots, {
      edgeTypes: input.edgeTypes,
    }),
    addedNodeIds: [...addedNodeIds],
    removedNodeIds: [...removedNodeIds],
    changedEdgeIds: [...changedEdgeIds],
  };
}

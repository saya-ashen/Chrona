import type {
  GraphMutation,
  GraphMutationOperation,
  LayerSource,
  PlanGraph,
} from "./types";

export type ApplyGraphMutationInput = {
  graph: PlanGraph;
  operations: GraphMutationOperation[];
  reason: string;
  createdBy?: LayerSource;
  now?: string;
  mutationId?: string;
};

export type GraphMutationEvent = {
  type: "graph_mutation_applied";
  mutation: GraphMutation;
};

export type ApplyGraphMutationResult = {
  graph: PlanGraph;
  mutation: GraphMutation;
  events: GraphMutationEvent[];
};

export type GraphMutationValidationIssue = {
  code: string;
  message: string;
  operationIndex?: number;
};

export class GraphMutationValidationError extends Error {
  readonly issues: GraphMutationValidationIssue[];

  constructor(issues: GraphMutationValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "GraphMutationValidationError";
    this.issues = issues;
  }
}

function validateGraphMutationOperation(
  graph: PlanGraph,
  operation: GraphMutationOperation,
  operationIndex: number,
): GraphMutationValidationIssue[] {
  const issues: GraphMutationValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));

  switch (operation.type) {
    case "add_node":
      if (nodeIds.has(operation.nodeId)) {
        issues.push({
          code: "DUPLICATE_NODE_ID",
          message: `Node already exists: ${operation.nodeId}`,
          operationIndex,
        });
      }
      if (operation.definitionLayer.nodeId !== operation.nodeId) {
        issues.push({
          code: "LAYER_NODE_MISMATCH",
          message: `Definition layer nodeId does not match node: ${operation.nodeId}`,
          operationIndex,
        });
      }
      break;
    case "push_node_layer":
      if (!nodeIds.has(operation.nodeId)) {
        issues.push({
          code: "UNKNOWN_NODE_ID",
          message: `Cannot push layer for unknown node: ${operation.nodeId}`,
          operationIndex,
        });
      }
      if (operation.layer.nodeId !== operation.nodeId) {
        issues.push({
          code: "LAYER_NODE_MISMATCH",
          message: `Layer nodeId does not match node: ${operation.nodeId}`,
          operationIndex,
        });
      }
      break;
    case "add_edge":
      if (edgeIds.has(operation.edge.id)) {
        issues.push({
          code: "DUPLICATE_EDGE_ID",
          message: `Edge already exists: ${operation.edge.id}`,
          operationIndex,
        });
      }
      if (!nodeIds.has(operation.edge.fromNodeId) || !nodeIds.has(operation.edge.toNodeId)) {
        issues.push({
          code: "UNKNOWN_EDGE_NODE",
          message: `Edge references unknown node: ${operation.edge.id}`,
          operationIndex,
        });
      }
      break;
    case "remove_edge":
    case "update_edge":
      if (!edgeIds.has(operation.edgeId)) {
        issues.push({
          code: "UNKNOWN_EDGE_ID",
          message: `Unknown edge: ${operation.edgeId}`,
          operationIndex,
        });
      }
      break;
    case "delete_node":
      if (!nodeIds.has(operation.nodeId)) {
        issues.push({
          code: "UNKNOWN_NODE_ID",
          message: `Unknown node: ${operation.nodeId}`,
          operationIndex,
        });
      }
      break;
    case "replace_subgraph": {
      for (const nodeId of operation.removeNodeIds) {
        if (!nodeIds.has(nodeId)) {
          issues.push({
            code: "UNKNOWN_NODE_ID",
            message: `Cannot replace unknown node: ${nodeId}`,
            operationIndex,
          });
        }
      }
      const replacingNodeIds = new Set(operation.removeNodeIds);
      const newNodeIds = new Set<string>();
      for (const node of operation.nodes) {
        if (newNodeIds.has(node.nodeId)) {
          issues.push({
            code: "DUPLICATE_NODE_ID",
            message: `Replacement subgraph contains duplicate node: ${node.nodeId}`,
            operationIndex,
          });
        }
        newNodeIds.add(node.nodeId);
        if (node.definitionLayer.nodeId !== node.nodeId) {
          issues.push({
            code: "LAYER_NODE_MISMATCH",
            message: `Definition layer nodeId does not match replacement node: ${node.nodeId}`,
            operationIndex,
          });
        }
        if (nodeIds.has(node.nodeId) && !replacingNodeIds.has(node.nodeId)) {
          issues.push({
            code: "DUPLICATE_NODE_ID",
            message: `Replacement node already exists outside removed subgraph: ${node.nodeId}`,
            operationIndex,
          });
        }
      }
      const nextNodeIds = new Set([...nodeIds].filter((nodeId) => !replacingNodeIds.has(nodeId)));
      for (const nodeId of newNodeIds) nextNodeIds.add(nodeId);
      const newEdgeIds = new Set<string>();
      for (const edge of operation.edges) {
        if (edgeIds.has(edge.id) || newEdgeIds.has(edge.id)) {
          issues.push({
            code: "DUPLICATE_EDGE_ID",
            message: `Replacement subgraph contains duplicate edge: ${edge.id}`,
            operationIndex,
          });
        }
        newEdgeIds.add(edge.id);
        if (!nextNodeIds.has(edge.fromNodeId) || !nextNodeIds.has(edge.toNodeId)) {
          issues.push({
            code: "UNKNOWN_EDGE_NODE",
            message: `Replacement edge references unknown node: ${edge.id}`,
            operationIndex,
          });
        }
      }
      break;
    }
  }

  return issues;
}

export function validateGraphMutation(
  graph: PlanGraph,
  operations: GraphMutationOperation[],
): GraphMutationValidationIssue[] {
  const issues: GraphMutationValidationIssue[] = [];
  let stagedGraph = graph;
  operations.forEach((operation, index) => {
    const operationIssues = validateGraphMutationOperation(stagedGraph, operation, index);
    issues.push(...operationIssues);
    if (operationIssues.length === 0) {
      stagedGraph = applyOperation(stagedGraph, operation, stagedGraph.updatedAt);
    }
  });
  return issues;
}

function applyOperation(graph: PlanGraph, operation: GraphMutationOperation, now: string): PlanGraph {
  switch (operation.type) {
    case "add_node":
      return {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            id: operation.nodeId,
            semanticKey: operation.semanticKey,
            layers: [operation.definitionLayer],
            createdAt: operation.definitionLayer.createdAt,
            updatedAt: operation.definitionLayer.createdAt,
          },
        ],
      };
    case "push_node_layer":
      return {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === operation.nodeId
            ? {
                ...node,
                layers: [...node.layers, operation.layer],
                updatedAt: operation.layer.createdAt,
              }
            : node,
        ),
      };
    case "add_edge":
      return { ...graph, edges: [...graph.edges, operation.edge] };
    case "remove_edge":
      return {
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.id === operation.edgeId
            ? { ...edge, active: false, updatedAt: now }
            : edge,
        ),
      };
    case "update_edge":
      return {
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.id === operation.edgeId
            ? { ...edge, ...operation.patch, updatedAt: now }
            : edge,
        ),
      };
    case "delete_node":
      return {
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== operation.nodeId),
        edges: graph.edges.map((edge) =>
          edge.fromNodeId === operation.nodeId || edge.toNodeId === operation.nodeId
            ? { ...edge, active: false, updatedAt: now }
            : edge,
        ),
      };
    case "replace_subgraph": {
      const removeNodeIds = new Set(operation.removeNodeIds);
      const replacementNodes = operation.nodes.map((node) => ({
        id: node.nodeId,
        semanticKey: node.semanticKey,
        layers: [node.definitionLayer],
        createdAt: node.definitionLayer.createdAt,
        updatedAt: node.definitionLayer.createdAt,
      }));
      return {
        ...graph,
        nodes: [
          ...graph.nodes.filter((node) => !removeNodeIds.has(node.id)),
          ...replacementNodes,
        ],
        edges: [
          ...graph.edges.map((edge) =>
            removeNodeIds.has(edge.fromNodeId) || removeNodeIds.has(edge.toNodeId)
              ? { ...edge, active: false, updatedAt: now }
              : edge,
          ),
          ...operation.edges,
        ],
      };
    }
  }
}

function getAffectedNodeIds(operations: GraphMutationOperation[]): string[] {
  const nodeIds = new Set<string>();
  for (const operation of operations) {
    switch (operation.type) {
      case "add_node":
      case "push_node_layer":
      case "delete_node":
        nodeIds.add(operation.nodeId);
        break;
      case "replace_subgraph":
        for (const nodeId of operation.removeNodeIds) nodeIds.add(nodeId);
        for (const node of operation.nodes) nodeIds.add(node.nodeId);
        for (const edge of operation.edges) {
          nodeIds.add(edge.fromNodeId);
          nodeIds.add(edge.toNodeId);
        }
        break;
      case "add_edge":
        nodeIds.add(operation.edge.fromNodeId);
        nodeIds.add(operation.edge.toNodeId);
        break;
      case "remove_edge":
      case "update_edge":
        break;
    }
  }
  return [...nodeIds];
}

export function applyGraphMutation(input: ApplyGraphMutationInput): ApplyGraphMutationResult {
  const issues = validateGraphMutation(input.graph, input.operations);
  if (issues.length > 0) throw new GraphMutationValidationError(issues);

  const now = input.now ?? new Date().toISOString();
  const mutation: GraphMutation = {
    id: input.mutationId ?? `mutation_${input.graph.id}_${input.graph.mutations.length + 1}`,
    graphId: input.graph.id,
    createdAt: now,
    createdBy: input.createdBy ?? "system",
    reason: input.reason,
    operations: input.operations,
    affectedNodeIds: getAffectedNodeIds(input.operations),
    invalidatedNodeIds: [],
  };

  const nextGraph = input.operations.reduce(
    (graph, operation) => applyOperation(graph, operation, now),
    input.graph,
  );
  const graph = {
    ...nextGraph,
    mutations: [...nextGraph.mutations, mutation],
    updatedAt: now,
  };

  return {
    graph,
    mutation,
    events: [{ type: "graph_mutation_applied", mutation }],
  };
}

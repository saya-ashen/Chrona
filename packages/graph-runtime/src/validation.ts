import type { ConditionConfig, EffectivePlanGraph, NodeDefinition, PlanGraph } from "./types";

export type GraphValidationIssueSeverity = "error" | "warning";

export type GraphValidationIssue = {
  code: string;
  message: string;
  severity: GraphValidationIssueSeverity;
  nodeId?: string;
  edgeId?: string;
};

export type GraphValidationResult = {
  valid: boolean;
  issues: GraphValidationIssue[];
};

function pushIssue(
  issues: GraphValidationIssue[],
  issue: Omit<GraphValidationIssue, "severity"> & { severity?: GraphValidationIssueSeverity },
): void {
  issues.push({ severity: issue.severity ?? "error", ...issue });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getConditionConfig(definition: NodeDefinition): Partial<ConditionConfig> | null {
  if (definition.semantics.type !== "condition") {
    return null;
  }

  const metadataConfig = isRecord(definition.metadata?.config) ? definition.metadata.config : null;
  const semanticsConfig = isRecord(definition.semantics.metadata?.config)
    ? definition.semantics.metadata.config
    : null;
  const directMetadata = isRecord(definition.metadata) ? definition.metadata : null;
  const directSemanticsMetadata = isRecord(definition.semantics.metadata)
    ? definition.semantics.metadata
    : null;

  return (metadataConfig ?? semanticsConfig ?? directMetadata ?? directSemanticsMetadata) as Partial<ConditionConfig>;
}

function validateConditionBranchTargets(input: {
  issues: GraphValidationIssue[];
  nodeId: string;
  definition: NodeDefinition;
  nodeIds: Set<string>;
}): void {
  const config = getConditionConfig(input.definition);
  if (!config) {
    return;
  }

  if (!Array.isArray(config.branches)) {
    pushIssue(input.issues, {
      code: "MALFORMED_CONDITION_BRANCHES",
      message: `Condition node has malformed branches: ${input.nodeId}`,
      nodeId: input.nodeId,
    });
    return;
  }

  for (const branch of config.branches) {
    if (!branch || typeof branch.nextNodeId !== "string") {
      pushIssue(input.issues, {
        code: "MALFORMED_CONDITION_BRANCH",
        message: `Condition node has malformed branch target: ${input.nodeId}`,
        nodeId: input.nodeId,
      });
      continue;
    }

    if (!input.nodeIds.has(branch.nextNodeId)) {
      pushIssue(input.issues, {
        code: "INVALID_BRANCH_TARGET",
        message: `Condition branch target does not exist: ${input.nodeId} -> ${branch.nextNodeId}`,
        nodeId: input.nodeId,
      });
    }
  }

  if (config.defaultNextNodeId && !input.nodeIds.has(config.defaultNextNodeId)) {
    pushIssue(input.issues, {
      code: "INVALID_DEFAULT_BRANCH_TARGET",
      message: `Condition default branch target does not exist: ${input.nodeId} -> ${config.defaultNextNodeId}`,
      nodeId: input.nodeId,
    });
  }
}

export function validatePlanGraph(graph: PlanGraph): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      pushIssue(issues, {
        code: "DUPLICATE_NODE_ID",
        message: `Duplicate node id: ${node.id}`,
        nodeId: node.id,
      });
    }
    nodeIds.add(node.id);
  }

  for (const node of graph.nodes) {
    const definitionLayers = node.layers.filter((layer) => layer.type === "definition");
    if (definitionLayers.length === 0) {
      pushIssue(issues, {
        code: "MISSING_DEFINITION_LAYER",
        message: `Node has no definition layer: ${node.id}`,
        nodeId: node.id,
      });
    }
    for (const layer of node.layers) {
      if (layer.nodeId !== node.id) {
        pushIssue(issues, {
          code: "LAYER_NODE_MISMATCH",
          message: `Layer ${layer.id} nodeId does not match node ${node.id}`,
          nodeId: node.id,
        });
      }
      if (layer.type === "definition") {
        validateConditionBranchTargets({
          issues,
          nodeId: node.id,
          definition: layer.definition,
          nodeIds,
        });
      }
    }
  }

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      pushIssue(issues, {
        code: "DUPLICATE_EDGE_ID",
        message: `Duplicate edge id: ${edge.id}`,
        edgeId: edge.id,
      });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.fromNodeId)) {
      pushIssue(issues, {
        code: "MISSING_EDGE_SOURCE",
        message: `Edge source does not exist: ${edge.fromNodeId}`,
        edgeId: edge.id,
      });
    }
    if (!nodeIds.has(edge.toNodeId)) {
      pushIssue(issues, {
        code: "MISSING_EDGE_TARGET",
        message: `Edge target does not exist: ${edge.toNodeId}`,
        edgeId: edge.id,
      });
    }
  }

  validateReachability({ graph, issues, nodeIds });
  validateAcyclicDependencies({ graph, issues, nodeIds });

  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

function getActiveOutgoingTargets(graph: PlanGraph, fromNodeId: string): string[] {
  return graph.edges
    .filter((edge) => edge.active && edge.fromNodeId === fromNodeId)
    .map((edge) => edge.toNodeId);
}

function validateReachability(input: {
  graph: PlanGraph;
  issues: GraphValidationIssue[];
  nodeIds: Set<string>;
}): void {
  const incomingTargets = new Set(
    input.graph.edges
      .filter((edge) => edge.active && input.nodeIds.has(edge.fromNodeId) && input.nodeIds.has(edge.toNodeId))
      .map((edge) => edge.toNodeId),
  );
  const roots = input.graph.nodes
    .map((node) => node.id)
    .filter((nodeId) => !incomingTargets.has(nodeId));
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    for (const target of getActiveOutgoingTargets(input.graph, nodeId)) {
      if (input.nodeIds.has(target) && !visited.has(target)) {
        queue.push(target);
      }
    }
  }

  for (const nodeId of input.nodeIds) {
    if (!visited.has(nodeId)) {
      pushIssue(input.issues, {
        code: "UNREACHABLE_NODE",
        message: `Node is unreachable from graph roots: ${nodeId}`,
        nodeId,
        severity: "warning",
      });
    }
  }
}

function validateAcyclicDependencies(input: {
  graph: PlanGraph;
  issues: GraphValidationIssue[];
  nodeIds: Set<string>;
}): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();

  function visit(nodeId: string, path: string[]): void {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cyclePath = [...path.slice(Math.max(0, cycleStart)), nodeId];
      const key = cyclePath.join("->");
      if (!reported.has(key)) {
        reported.add(key);
        pushIssue(input.issues, {
          code: "CYCLE_DETECTED",
          message: `Graph contains a cycle: ${key}`,
          nodeId,
        });
      }
      return;
    }
    if (visited.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    for (const target of getActiveOutgoingTargets(input.graph, nodeId)) {
      if (input.nodeIds.has(target)) {
        visit(target, [...path, nodeId]);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of input.nodeIds) {
    visit(nodeId, []);
  }
}

export function validateEffectivePlanGraph(effective: EffectivePlanGraph): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const currentResultNodeIds = new Set<string>();

  for (const node of effective.nodes) {
    if (!node.activeLayerId) {
      pushIssue(issues, {
        code: "MISSING_ACTIVE_LAYER",
        message: `Effective node has no active definition layer: ${node.id}`,
        nodeId: node.id,
      });
    }
    if (node.result?.status === "current") {
      if (currentResultNodeIds.has(node.id)) {
        pushIssue(issues, {
          code: "DUPLICATE_CURRENT_RESULT",
          message: `Effective node has duplicate current results: ${node.id}`,
          nodeId: node.id,
        });
      }
      currentResultNodeIds.add(node.id);
    }
  }

  return { valid: issues.every((issue) => issue.severity !== "error"), issues };
}

export function assertValidPlanGraph(graph: PlanGraph): void {
  const result = validatePlanGraph(graph);
  if (!result.valid) {
    throw new Error(result.issues.map((issue) => issue.message).join("; "));
  }
}

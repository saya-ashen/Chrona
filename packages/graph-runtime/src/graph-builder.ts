import type {
  CheckpointConfig,
  CompiledNode,
  CompiledPlan,
  ConditionConfig,
  NodeDefinition,
  PlanGraph,
  TaskConfig,
  WaitConfig,
} from "./types";

function toNodeObjective(node: CompiledNode): string {
  switch (node.type) {
    case "task":
      return (node.config as TaskConfig).expectedOutput ?? node.description ?? node.title;
    case "checkpoint":
      return (node.config as CheckpointConfig).prompt ?? node.description ?? node.title;
    case "condition":
      return (node.config as ConditionConfig).condition ?? node.description ?? node.title;
    case "wait":
      return (node.config as WaitConfig).waitFor ?? node.description ?? node.title;
  }
}

export function createNodeDefinitionFromCompiledNode(
  node: CompiledNode,
  linkedTaskId?: string,
): NodeDefinition {
  return {
    title: node.title,
    objective: toNodeObjective(node),
    description: node.description,
    semantics: {
      type: node.type,
      priority: node.priority,
      mode: node.mode,
      linkedTaskId: linkedTaskId ?? node.linkedTaskId,
      metadata: structuredClone(node.config as Record<string, unknown>),
    },
    executor: node.executor,
    estimatedMinutes: node.estimatedMinutes,
    metadata: structuredClone(node.config as Record<string, unknown>),
  };
}

export function createPlanGraphFromCompiledPlan(input: {
  taskId: string;
  compiledPlan: CompiledPlan;
  existingGraph?: PlanGraph;
  now?: string;
}): PlanGraph {
  const timestamp = input.now ?? new Date().toISOString();

  return {
    id: input.existingGraph?.id ?? input.compiledPlan.editablePlanId,
    taskId: input.taskId,
    status: input.existingGraph?.status ?? "active",
    nodes: input.compiledPlan.nodes.map((node) => ({
      id: node.id,
      semanticKey: node.localId,
      layers: [
        {
          id: `node_layer_${input.compiledPlan.editablePlanId}_${node.id}_v${input.compiledPlan.sourceVersion}`,
          nodeId: node.id,
          type: "definition",
          createdAt: input.existingGraph?.createdAt ?? timestamp,
          createdBy: "system",
          definition: createNodeDefinitionFromCompiledNode(node),
        },
      ],
      createdAt: input.existingGraph?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })),
    edges: input.compiledPlan.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      type: edge.label ? "branch" : "hard_dependency",
      active: true,
      label: edge.label,
      createdAt: input.existingGraph?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })),
    mutations: input.existingGraph?.mutations ?? [],
    createdAt: input.existingGraph?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

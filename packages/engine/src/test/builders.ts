import type { CompiledEdge, CompiledNode, CompiledPlan } from "@chrona/contracts/ai";

export function buildCompiledNode(overrides: Partial<CompiledNode> & { id: string }): CompiledNode {
  return {
    id: overrides.id,
    localId: overrides.localId ?? overrides.id,
    type: overrides.type ?? "task",
    title: overrides.title ?? overrides.id.replaceAll("-", " "),
    description: overrides.description,
    priority: overrides.priority ?? "Medium",
    linkedTaskId: overrides.linkedTaskId,
    config: overrides.config ?? {},
    dependencies: overrides.dependencies ?? [],
    dependents: overrides.dependents ?? [],
    executor: overrides.executor ?? "ai",
    mode: overrides.mode ?? "auto",
    estimatedMinutes: overrides.estimatedMinutes ?? 10,
  };
}

export function buildCompiledEdge(from: string, to: string, overrides?: Partial<CompiledEdge>): CompiledEdge {
  return {
    id: overrides?.id ?? `${from}-to-${to}`,
    from,
    to,
    label: overrides?.label,
  };
}

export function buildCompiledPlan(input: {
  id?: string;
  title?: string;
  goal?: string;
  nodes: CompiledNode[];
  edges?: CompiledEdge[];
}): CompiledPlan {
  return {
    id: input.id ?? "compiled-test-plan",
    editablePlanId: input.id ?? "editable-test-plan",
    sourceVersion: 1,
    title: input.title ?? "Test Plan",
    goal: input.goal ?? "Exercise deterministic test behavior",
    assumptions: [],
    nodes: input.nodes,
    edges: input.edges ?? [],
    entryNodeIds: input.nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id),
    terminalNodeIds: input.nodes.filter((node) => node.dependents.length === 0).map((node) => node.id),
    topologicalOrder: input.nodes.map((node) => node.id),
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

export function buildLinearCompiledPlan(nodeIds = ["collect", "implement", "review"]): CompiledPlan {
  const nodes = nodeIds.map((id, index) => buildCompiledNode({
    id,
    dependencies: index === 0 ? [] : [nodeIds[index - 1]],
    dependents: index === nodeIds.length - 1 ? [] : [nodeIds[index + 1]],
  }));

  return buildCompiledPlan({
    id: "linear-test-plan",
    nodes,
    edges: nodeIds.slice(0, -1).map((from, index) => buildCompiledEdge(from, nodeIds[index + 1])),
  });
}

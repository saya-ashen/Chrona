import type {
  EditablePlan,
  EditableNode,
  CompiledPlan,
  CompiledNode,
  CompiledEdge,
  ValidationWarning,
  TaskConfig,
  CheckpointConfig,
  ConditionConfig,
  WaitConfig,
} from "@chrona/contracts/ai";
import { PlanCompileError } from "@chrona/contracts/ai";
import { validateEditablePlan } from "./validate";

let idCounter = 0;

function generateCompiledId(): string {
  idCounter += 1;
  return `cn_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

function rewriteConditionTarget(
  nodeId: string,
  targetNodeId: string,
  localToCompiled: Map<string, string>,
): string {
  const compiledTarget = localToCompiled.get(targetNodeId);
  if (!compiledTarget) {
    throw new PlanCompileError("Condition references unresolvable node", [
      {
        path: `nodes.${nodeId}.branches`,
        message: `Cannot resolve condition target ${nodeId} → ${targetNodeId}`,
      },
    ]);
  }
  return compiledTarget;
}

function buildNodeConfig(
  node: EditableNode,
  localToCompiled?: Map<string, string>,
): CompiledNode["config"] {
  switch (node.type) {
    case "task":
      return {
        expectedOutput: node.expectedOutput,
        completionCriteria: node.completionCriteria,
      } satisfies TaskConfig;
    case "checkpoint":
      return {
        checkpointType: node.checkpointType,
        prompt: node.prompt,
        required: node.required,
        options: node.options,
        inputFields: node.inputFields,
      } satisfies CheckpointConfig;
    case "condition":
      if (!localToCompiled) {
        return {
          condition: node.condition,
          evaluationBy: node.evaluationBy,
          branches: node.branches,
          defaultNextNodeId: node.defaultNextNodeId,
        } satisfies ConditionConfig;
      }
      return {
        condition: node.condition,
        evaluationBy: node.evaluationBy,
        branches: node.branches.map((branch) => ({
          ...branch,
          nextNodeId: rewriteConditionTarget(
            node.id,
            branch.nextNodeId,
            localToCompiled,
          ),
        })),
        defaultNextNodeId: node.defaultNextNodeId
          ? rewriteConditionTarget(node.id, node.defaultNextNodeId, localToCompiled)
          : undefined,
      } satisfies ConditionConfig;
    case "wait":
      return {
        waitFor: node.waitFor,
        timeout: node.timeout,
      } satisfies WaitConfig;
  }
}

function buildCompiledNode(
  node: EditableNode,
  compiledId: string,
  localToCompiled?: Map<string, string>,
): CompiledNode {
  const base: CompiledNode = {
    id: compiledId,
    localId: node.id,
    type: node.type,
    title: node.title,
    config: buildNodeConfig(node, localToCompiled),
    dependencies: [],
    dependents: [],
  };

  if (node.type === "task") {
    base.executor = node.executor;
    base.mode = node.mode;
  }

  if ("estimatedMinutes" in node && node.estimatedMinutes !== undefined) {
    base.estimatedMinutes = node.estimatedMinutes;
  }

  return base;
}

function edgeKey(from: string, to: string): string {
  return `${from}→${to}`;
}

/**
 * Compiles an EditablePlan into a CompiledPlan.
 *
 * Process:
 * 1. Validates the editable plan (rejects on errors)
 * 2. Generates stable compiled node IDs with localId mapping
 * 3. Rewrites edges using compiled node IDs
 * 4. Computes dependencies/dependents from edges
 * 5. Computes entryNodeIds / terminalNodeIds
 * 6. Injects completionPolicy
 * 7. Carries forward validation warnings
 *
 * Does NOT include runtime state (status, attempts, logs, etc.)
 */
export function compileEditablePlan(plan: EditablePlan): CompiledPlan {
  // 1. Validate
  const validation = validateEditablePlan(plan);
  if (!validation.ok) {
    throw new PlanCompileError(
      "Plan validation failed during compilation",
      validation.errors.map((e) => ({ path: e.path, message: e.message })),
    );
  }

  // 2. Build localId → compiledId mapping + compiled nodes
  const localToCompiled = new Map<string, string>();
  const compiledNodeIds = plan.nodes.map((node) => ({
    node,
    compiledId: generateCompiledId(),
  }));
  for (const { node, compiledId } of compiledNodeIds) {
    localToCompiled.set(node.id, compiledId);
  }
  const compiledNodes: CompiledNode[] = compiledNodeIds.map(({ node, compiledId }) => {
    return buildCompiledNode(node, compiledId, localToCompiled);
  });

  // 3. Rewrite edges
  const compiledEdgeMap = new Map<string, CompiledEdge>();
  for (const edge of plan.edges) {
    const fromCompiled = localToCompiled.get(edge.from);
    const toCompiled = localToCompiled.get(edge.to);
    if (!fromCompiled || !toCompiled) {
      throw new PlanCompileError("Edge references unresolvable node", [
        { path: "edges", message: `Cannot resolve edge ${edge.from} → ${edge.to}` },
      ]);
    }
    const compiledEdge: CompiledEdge = {
      id: `ce_${generateCompiledId()}`,
      from: fromCompiled,
      to: toCompiled,
      label: edge.label,
    };
    compiledEdgeMap.set(edgeKey(compiledEdge.from, compiledEdge.to), compiledEdge);
  }

  // Condition branch semantics are the canonical source for condition edge labels.
  // Explicit edges only establish connectivity; branch/default metadata owns the label.
  for (const node of plan.nodes) {
    if (node.type !== "condition") continue;
    const fromCompiled = localToCompiled.get(node.id)!;
    for (const branch of node.branches) {
      const toCompiled = localToCompiled.get(branch.nextNodeId);
      if (toCompiled) {
        const key = edgeKey(fromCompiled, toCompiled);
        const existing = compiledEdgeMap.get(key);
        if (existing) {
          existing.label = branch.label;
        } else {
          compiledEdgeMap.set(key, {
            id: `ce_${generateCompiledId()}`,
            from: fromCompiled,
            to: toCompiled,
            label: branch.label,
          });
        }
      }
    }
    if (node.defaultNextNodeId) {
      const toCompiled = localToCompiled.get(node.defaultNextNodeId);
      if (toCompiled) {
        const key = edgeKey(fromCompiled, toCompiled);
        const existing = compiledEdgeMap.get(key);
        if (existing) {
          // Keep explicit branch labels canonical when the default target overlaps
          // an existing condition branch. Default only labels fallback-only edges.
        } else {
          compiledEdgeMap.set(key, {
            id: `ce_${generateCompiledId()}`,
            from: fromCompiled,
            to: toCompiled,
            label: "default",
          });
        }
      }
    }
  }

  const compiledEdges = [...compiledEdgeMap.values()];

  // 4. Compute dependencies / dependents
  const indegree = new Map<string, string[]>();
  const outdegree = new Map<string, string[]>();
  for (const node of compiledNodes) {
    indegree.set(node.id, []);
    outdegree.set(node.id, []);
  }
  for (const edge of compiledEdges) {
    indegree.get(edge.to)?.push(edge.from);
    outdegree.get(edge.from)?.push(edge.to);
  }
  for (const node of compiledNodes) {
    node.dependencies = indegree.get(node.id) ?? [];
    node.dependents = outdegree.get(node.id) ?? [];
  }

  // 5. Entry / terminal nodes
  const entryNodeIds = compiledNodes
    .filter((n) => (indegree.get(n.id)?.length ?? 0) === 0)
    .map((n) => n.id);

  const terminalNodeIds = compiledNodes
    .filter((n) => (outdegree.get(n.id)?.length ?? 0) === 0)
    .map((n) => n.id);

  // 5b. Topological order (Kahn's algorithm)
  const topologicalOrder = computeTopologicalOrder(
    compiledNodes.map((n) => n.id),
    compiledEdges,
  );

  // 6. Completion policy
  const completionPolicy = { type: "all_tasks_completed" as const };

  // 7. Validation warnings
  const validationWarnings: ValidationWarning[] = validation.warnings;

  return {
    id: `compiled_${plan.id}_v${plan.version}`,
    editablePlanId: plan.id,
    sourceVersion: plan.version,
    title: plan.title,
    goal: plan.goal,
    assumptions: plan.assumptions ?? [],
    nodes: compiledNodes,
    edges: compiledEdges,
    entryNodeIds,
    terminalNodeIds,
    topologicalOrder,
    completionPolicy,
    validationWarnings,
  };
}

function computeTopologicalOrder(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
): string[] {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const e of edges) {
    adjacency.get(e.from)?.push(e.to);
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (indegree.get(neighbor) ?? 1) - 1;
      indegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return order;
}

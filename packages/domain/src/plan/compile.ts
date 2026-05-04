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

function buildNodeConfig(node: EditableNode): CompiledNode["config"] {
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
      return {
        condition: node.condition,
        evaluationBy: node.evaluationBy,
        branches: node.branches,
        defaultNextNodeId: node.defaultNextNodeId,
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
): CompiledNode {
  const base: CompiledNode = {
    id: compiledId,
    localId: node.id,
    type: node.type,
    title: node.title,
    config: buildNodeConfig(node),
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
  const compiledNodes: CompiledNode[] = plan.nodes.map((node) => {
    const compiledId = generateCompiledId();
    localToCompiled.set(node.id, compiledId);
    return buildCompiledNode(node, compiledId);
  });

  // 3. Rewrite edges
  const compiledEdges: CompiledEdge[] = [];
  for (const edge of plan.edges) {
    const fromCompiled = localToCompiled.get(edge.from);
    const toCompiled = localToCompiled.get(edge.to);
    if (!fromCompiled || !toCompiled) {
      throw new PlanCompileError("Edge references unresolvable node", [
        { path: "edges", message: `Cannot resolve edge ${edge.from} → ${edge.to}` },
      ]);
    }
    compiledEdges.push({
      id: `ce_${generateCompiledId()}`,
      from: fromCompiled,
      to: toCompiled,
      label: edge.label,
    });
  }

  // Also add implicit edges from condition branches
  for (const node of plan.nodes) {
    if (node.type !== "condition") continue;
    const fromCompiled = localToCompiled.get(node.id)!;
    for (const branch of node.branches) {
      const toCompiled = localToCompiled.get(branch.nextNodeId);
      if (toCompiled) {
        // Only add if not already present
        const exists = compiledEdges.some(
          (e) => e.from === fromCompiled && e.to === toCompiled,
        );
        if (!exists) {
          compiledEdges.push({
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
        const exists = compiledEdges.some(
          (e) => e.from === fromCompiled && e.to === toCompiled,
        );
        if (!exists) {
          compiledEdges.push({
            id: `ce_${generateCompiledId()}`,
            from: fromCompiled,
            to: toCompiled,
            label: "default",
          });
        }
      }
    }
  }

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
    completionPolicy,
    validationWarnings,
  };
}

import type {
  EditablePlan,
  EditableNode,
  EditableConditionNode,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from "@chrona/contracts/ai";

const STABLE_NODE_ID = /^[a-z][a-z0-9_]*$/;
const VALID_NODE_TYPES = new Set(["task", "checkpoint", "condition", "wait"]);

type PlanEdge = { from: string; to: string };

function uniqueEdges(edges: PlanEdge[]): PlanEdge[] {
  const seen = new Set<string>();
  const result: PlanEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.from}→${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function semanticEdges(plan: EditablePlan, nodeIds: Set<string>): PlanEdge[] {
  const edges: PlanEdge[] = plan.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge) => ({ from: edge.from, to: edge.to }));

  for (const node of plan.nodes) {
    if (node.type !== "condition") continue;
    const conditionNode = node as EditableConditionNode;
    for (const branch of conditionNode.branches) {
      if (nodeIds.has(branch.nextNodeId)) {
        edges.push({ from: conditionNode.id, to: branch.nextNodeId });
      }
    }
    if (conditionNode.defaultNextNodeId && nodeIds.has(conditionNode.defaultNextNodeId)) {
      edges.push({ from: conditionNode.id, to: conditionNode.defaultNextNodeId });
    }
  }

  return uniqueEdges(edges);
}

function terminalNodeIds(nodeIds: string[], edges: PlanEdge[]): string[] {
  const outgoing = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }
  return nodeIds.filter((id) => (outgoing.get(id) ?? 0) === 0);
}

function isDag(nodeIds: string[], edges: Array<{ from: string; to: string }>): boolean {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));

  for (const edge of edges) {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }
  return visited === nodeIds.length;
}

/**
 * Validates an EditablePlan. Returns { ok: boolean, errors, warnings }.
 * Errors are structural/contract violations. Warnings are advisory.
 */
export function validateEditablePlan(plan: EditablePlan): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. At least one node
  if (plan.nodes.length === 0) {
    errors.push({ path: "nodes", message: "Plan must have at least one node" });
    return { ok: false, errors, warnings };
  }

  // 2. Collect node ids, check uniqueness + snake_case + valid type
  const nodeIds = new Map<string, number>(); // id -> index
  const invalidTypes: string[] = [
    "start",
    "end",
    "ai_action",
    "tool_action",
    "integration",
    "deliverable",
    "user_input",
    "decision",
    "milestone",
  ];

  plan.nodes.forEach((node, index) => {
    // Check valid type
    if (!VALID_NODE_TYPES.has(node.type)) {
      errors.push({
        path: `nodes.${index}.type`,
        message: `Invalid node type '${node.type}'. Must be one of: task, checkpoint, condition, wait`,
      });
    }

    // Check for forbidden types (redundant with above but catches case where Zod allows)
    if (invalidTypes.includes(node.type)) {
      errors.push({
        path: `nodes.${index}.type`,
        message: `Forbidden node type '${node.type}'. Use task/checkpoint/condition/wait instead.`,
      });
    }

    // Check snake_case
    if (!STABLE_NODE_ID.test(node.id)) {
      errors.push({
        path: `nodes.${index}.id`,
        message: `Node id '${node.id}' must be snake_case (^[a-z][a-z0-9_]*$)`,
      });
    }

    // Check duplicate
    if (nodeIds.has(node.id)) {
      errors.push({
        path: `nodes.${index}.id`,
        message: `Duplicate node id '${node.id}'`,
      });
    }
    nodeIds.set(node.id, index);

    // Type-specific validation
    validateNodeSpecific(node, index, errors);
  });

  // 3. Edge validation
  plan.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        path: `edges.${index}.from`,
        message: `Edge references unknown source node '${edge.from}'`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        path: `edges.${index}.to`,
        message: `Edge references unknown target node '${edge.to}'`,
      });
    }
  });

  // 4. Condition branch references
  plan.nodes.forEach((node, nodeIndex) => {
    if (node.type !== "condition") return;
    const conditionNode = node as EditableConditionNode;

    conditionNode.branches.forEach((branch, branchIndex) => {
      if (!nodeIds.has(branch.nextNodeId)) {
        errors.push({
          path: `nodes.${nodeIndex}.branches.${branchIndex}.nextNodeId`,
          message: `Condition branch '${branch.label}' references unknown node '${branch.nextNodeId}'`,
        });
      }
    });

    if (conditionNode.defaultNextNodeId && !nodeIds.has(conditionNode.defaultNextNodeId)) {
      errors.push({
        path: `nodes.${nodeIndex}.defaultNextNodeId`,
        message: `Condition defaultNextNodeId '${conditionNode.defaultNextNodeId}' references unknown node`,
      });
    }
  });
  // 5. Check DAG and terminal shape over the semantic graph. Condition branches
  // are execution edges even when omitted from edges[]. Multiple entry nodes are
  // allowed for real parallel starts; plans must still converge to one final task.
  if (errors.length === 0) {
    const allNodeIds = [...nodeIds.keys()];
    const graphEdges = semanticEdges(plan, new Set(allNodeIds));
    if (!isDag(allNodeIds, graphEdges)) {
      errors.push({
        path: "edges",
        message: "Plan graph must be a DAG (no cycles allowed)",
      });
    }

    const terminals = terminalNodeIds(allNodeIds, graphEdges);
    if (terminals.length !== 1) {
      errors.push({
        path: "nodes",
        message: `Plan must have exactly one terminal node; found ${terminals.length}: ${terminals.join(", ")}`,
      });
    } else {
      const terminalNode = plan.nodes.find((node) => node.id === terminals[0]);
      if (terminalNode?.type !== "task") {
        errors.push({
          path: `nodes.${nodeIds.get(terminals[0]!)}`,
          message: "Plan terminal node must be a task that delivers the result",
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

function validateNodeSpecific(
  node: EditableNode,
  index: number,
  errors: ValidationError[],
): void {
  switch (node.type) {
    case "task": {
      if (!node.executor) {
        errors.push({
          path: `nodes.${index}.executor`,
          message: "Task node must have an executor",
        });
      }
      if (!node.mode) {
        errors.push({
          path: `nodes.${index}.mode`,
          message: "Task node must have a mode",
        });
      }
      const isManual = node.executor === "user" || node.mode === "manual";
      if (isManual && !node.completionForm) {
        errors.push({
          path: `nodes.${index}.completionForm`,
          message: "Manual task node must define a completion form",
        });
      }
      if (!isManual && node.completionForm) {
        errors.push({
          path: `nodes.${index}.completionForm`,
          message: "Automatic task node must not define a completion form",
        });
      }
      break;
    }
    case "checkpoint": {
      if (!node.checkpointType) {
        errors.push({
          path: `nodes.${index}.checkpointType`,
          message: "Checkpoint node must have a checkpointType",
        });
      }
      if (!node.prompt) {
        errors.push({
          path: `nodes.${index}.prompt`,
          message: "Checkpoint node must have a prompt",
        });
      }
      if (node.required === undefined) {
        errors.push({
          path: `nodes.${index}.required`,
          message: "Checkpoint node must specify required (true/false)",
        });
      }
      if (node.interaction?.schemaSource === "static") {
        const hasChoiceOptions = node.checkpointType === "choose" && (node.options?.length ?? 0) > 0;
        const hasInputFields =
          (node.checkpointType === "input" || node.checkpointType === "edit") &&
          (node.inputFields?.length ?? 0) > 0;
        const needsStructuredForm =
          node.checkpointType === "choose" || node.checkpointType === "input" || node.checkpointType === "edit";
        if (needsStructuredForm && !hasChoiceOptions && !hasInputFields) {
          errors.push({
            path: `nodes.${index}.interaction`,
            message: "Static checkpoint must define its complete options or input fields",
          });
        }
      }
      if (
        node.interaction?.schemaSource === "ai" &&
        ((node.options?.length ?? 0) > 0 || (node.inputFields?.length ?? 0) > 0)
      ) {
        errors.push({
          path: `nodes.${index}.interaction`,
          message: "AI-defined checkpoint must not include static options or input fields",
        });
      }
      break;
    }
    case "condition": {
      const cn = node as EditableConditionNode;
      if (cn.branches.length === 0) {
        errors.push({
          path: `nodes.${index}.branches`,
          message: "Condition node must have at least one branch",
        });
      }
      break;
    }
    case "wait": {
      if (!node.waitFor) {
        errors.push({
          path: `nodes.${index}.waitFor`,
          message: "Wait node must specify waitFor",
        });
      }
      break;
    }
  }
}

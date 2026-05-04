import type {
  EditablePlan,
  EditableNode,
  EditableEdge,
  PlanPatch,
  PlanPatchOperation,
  ValidationResult,
} from "@chrona/contracts/ai";
import { validateEditablePlan } from "./validate";

export interface ApplyPatchResult {
  ok: boolean;
  plan?: EditablePlan;
  error?: string;
  validation?: ValidationResult;
}

/**
 * Applies a PlanPatch to an EditablePlan immutably.
 *
 * Rules:
 * - baseVersion must match plan.version (optimistic locking)
 * - After applying all operations, re-validates
 * - If validation fails, returns error without returning plan
 * - On success, increments version
 * - update_node cannot change node.type
 * - delete_node removes associated edges
 * - Never mutates the input plan
 */
export function applyPlanPatch(plan: EditablePlan, patch: PlanPatch): ApplyPatchResult {
  // Version check (optimistic locking)
  if (patch.baseVersion !== plan.version) {
    return {
      ok: false,
      error: `Version conflict: patch baseVersion ${patch.baseVersion} does not match current plan version ${plan.version}`,
    };
  }

  if (patch.basePlanId !== plan.id) {
    return {
      ok: false,
      error: `Plan ID mismatch: patch basePlanId '${patch.basePlanId}' does not match plan id '${plan.id}'`,
    };
  }

  let nodes = [...plan.nodes];
  let edges = [...plan.edges];
  let title = plan.title;
  let goal = plan.goal;
  let assumptions = plan.assumptions ? [...plan.assumptions] : undefined;

  for (const op of patch.operations) {
    const result = applyOperation(nodes, edges, title, goal, assumptions, op);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    nodes = result.nodes;
    edges = result.edges;
    title = result.title;
    goal = result.goal;
    assumptions = result.assumptions;
  }

  // Build the new plan for validation
  const newPlan: EditablePlan = {
    id: plan.id,
    version: plan.version + 1,
    title,
    goal,
    assumptions,
    nodes,
    edges,
  };

  // Re-validate
  const validation = validateEditablePlan(newPlan);
  if (!validation.ok) {
    return {
      ok: false,
      error: `Patch validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
      validation,
    };
  }

  return { ok: true, plan: newPlan };
}

interface OperationState {
  ok: boolean;
  nodes: EditableNode[];
  edges: EditableEdge[];
  title: string;
  goal: string;
  assumptions?: string[];
  error?: string;
}

function applyOperation(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: PlanPatchOperation,
): OperationState {
  switch (op.op) {
    case "update_plan":
      return applyUpdatePlan(nodes, edges, title, goal, assumptions, op);

    case "add_node":
      return applyAddNode(nodes, edges, title, goal, assumptions, op);

    case "update_node":
      return applyUpdateNode(nodes, edges, title, goal, assumptions, op);

    case "delete_node":
      return applyDeleteNode(nodes, edges, title, goal, assumptions, op);

    case "add_edge":
      return applyAddEdge(nodes, edges, title, goal, assumptions, op);

    case "delete_edge":
      return applyDeleteEdge(nodes, edges, title, goal, assumptions, op);

    case "replace_subgraph":
      return applyReplaceSubgraph(nodes, edges, title, goal, assumptions, op);

    default:
      return { ok: false, nodes, edges, title, goal, assumptions, error: `Unknown operation` };
  }
}

function applyUpdatePlan(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "update_plan" }>,
): OperationState {
  const newTitle = op.patch.title ?? title;
  const newGoal = op.patch.goal ?? goal;
  const newAssumptions = op.patch.assumptions
    ? [...op.patch.assumptions]
    : assumptions;
  return { ok: true, nodes, edges, title: newTitle, goal: newGoal, assumptions: newAssumptions };
}

function applyAddNode(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "add_node" }>,
): OperationState {
  // Check duplicate id
  if (nodes.some((n) => n.id === op.node.id)) {
    return {
      ok: false,
      nodes,
      edges,
      title,
      goal,
      assumptions,
      error: `Node with id '${op.node.id}' already exists`,
    };
  }
  return {
    ok: true,
    nodes: [...nodes, op.node],
    edges,
    title,
    goal,
    assumptions,
  };
}

function applyUpdateNode(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "update_node" }>,
): OperationState {
  const nodeIndex = nodes.findIndex((n) => n.id === op.nodeId);
  if (nodeIndex === -1) {
    return {
      ok: false,
      nodes,
      edges,
      title,
      goal,
      assumptions,
      error: `Node with id '${op.nodeId}' not found`,
    };
  }

  // Forbid changing node.type
  if (op.patch.type !== undefined && op.patch.type !== nodes[nodeIndex].type) {
    return {
      ok: false,
      nodes,
      edges,
      title,
      goal,
      assumptions,
      error: `Cannot change node type from '${nodes[nodeIndex].type}' to '${op.patch.type}'`,
    };
  }

  const updatedNodes = [...nodes];
  // Merge patch while preserving the node's discriminated union type
  const existingNode = nodes[nodeIndex];
  updatedNodes[nodeIndex] = { ...existingNode, ...op.patch } as typeof existingNode;

  return {
    ok: true,
    nodes: updatedNodes,
    edges,
    title,
    goal,
    assumptions,
  };
}

function applyDeleteNode(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "delete_node" }>,
): OperationState {
  if (!nodes.some((n) => n.id === op.nodeId)) {
    return {
      ok: false,
      nodes,
      edges,
      title,
      goal,
      assumptions,
      error: `Node with id '${op.nodeId}' not found`,
    };
  }

  const newNodes = nodes.filter((n) => n.id !== op.nodeId);
  const newEdges = edges.filter(
    (e) => e.from !== op.nodeId && e.to !== op.nodeId,
  );

  return {
    ok: true,
    nodes: newNodes,
    edges: newEdges,
    title,
    goal,
    assumptions,
  };
}

function applyAddEdge(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "add_edge" }>,
): OperationState {
  // Check if edge already exists
  if (
    edges.some(
      (e) =>
        e.from === op.edge.from &&
        e.to === op.edge.to &&
        (e.label ?? "") === (op.edge.label ?? ""),
    )
  ) {
    return {
      ok: false,
      nodes,
      edges,
      title,
      goal,
      assumptions,
      error: `Edge from '${op.edge.from}' to '${op.edge.to}' already exists`,
    };
  }

  return {
    ok: true,
    nodes,
    edges: [...edges, op.edge],
    title,
    goal,
    assumptions,
  };
}

function applyDeleteEdge(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "delete_edge" }>,
): OperationState {
  const newEdges = edges.filter(
    (e) => !(e.from === op.from && e.to === op.to),
  );

  if (newEdges.length === edges.length) {
    return {
      ok: false,
      nodes,
      edges,
      title,
      goal,
      assumptions,
      error: `Edge from '${op.from}' to '${op.to}' not found`,
    };
  }

  return {
    ok: true,
    nodes,
    edges: newEdges,
    title,
    goal,
    assumptions,
  };
}

function applyReplaceSubgraph(
  nodes: EditableNode[],
  edges: EditableEdge[],
  title: string,
  goal: string,
  assumptions: string[] | undefined,
  op: Extract<PlanPatchOperation, { op: "replace_subgraph" }>,
): OperationState {
  const removeSet = new Set(op.removeNodeIds);

  // Check all removed nodes exist
  for (const id of op.removeNodeIds) {
    if (!nodes.some((n) => n.id === id)) {
      return {
        ok: false,
        nodes,
        edges,
        title,
        goal,
        assumptions,
        error: `Node with id '${id}' not found for replacement`,
      };
    }
  }

  // Check new nodes don't conflict with existing (non-removed) nodes
  for (const newNode of op.addNodes) {
    if (nodes.some((n) => n.id === newNode.id && !removeSet.has(n.id))) {
      return {
        ok: false,
        nodes,
        edges,
        title,
        goal,
        assumptions,
        error: `New node id '${newNode.id}' conflicts with existing node`,
      };
    }
  }

  const newNodes = [...nodes.filter((n) => !removeSet.has(n.id)), ...op.addNodes];
  const newEdges = [
    ...edges.filter((e) => !removeSet.has(e.from) && !removeSet.has(e.to)),
    ...op.addEdges,
  ];

  return {
    ok: true,
    nodes: newNodes,
    edges: newEdges,
    title,
    goal,
    assumptions,
  };
}

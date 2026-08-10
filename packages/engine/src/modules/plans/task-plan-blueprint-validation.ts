/* eslint-disable max-statements, complexity, @typescript-eslint/no-unnecessary-condition -- Blueprint validation enumerates every graph and node contract invariant. */
import { planBlueprintSchema, type PlanBlueprint } from "@chrona/contracts";

export type TaskPlanBlueprintValidation = {
  ok: boolean;
  issues: Array<{ code: string; path?: string; message: string }>;
};

export function validateTaskPlanBlueprint(blueprint: PlanBlueprint): TaskPlanBlueprintValidation {
  const parsed = planBlueprintSchema.safeParse(blueprint);
  const issues: TaskPlanBlueprintValidation["issues"] = [];
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        path: `/${issue.path.join("/")}`,
        message: issue.message,
      })),
    };
  }

  const nodeIds = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const [index, node] of blueprint.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      issues.push({ code: "duplicate_node", path: `/nodes/${index}/id`, message: `Duplicate node id: ${node.id}` });
    }
    nodeIds.add(node.id);
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
    if (node.type === "task" && (!node.executor || !node.mode)) {
      issues.push({ code: "node_config", path: `/nodes/${index}`, message: "Task nodes require executor and mode." });
    }
    if (node.type === "checkpoint" && (node.required === undefined || !node.checkpointType || !node.prompt)) {
      issues.push({ code: "node_config", path: `/nodes/${index}`, message: "Checkpoint nodes require checkpointType, prompt, and required." });
    }
    if (node.type === "condition" && (!node.evaluationBy || node.branches.length === 0)) {
      issues.push({ code: "node_config", path: `/nodes/${index}`, message: "Condition nodes require evaluationBy and at least one branch." });
    }
    if (node.type === "wait" && !node.waitFor) {
      issues.push({ code: "node_config", path: `/nodes/${index}`, message: "Wait nodes require waitFor." });
    }
  }

  const edges = [...blueprint.edges];
  for (const node of blueprint.nodes) {
    if (node.type === "condition") {
      edges.push(...node.branches.map((branch) => ({ from: node.id, to: branch.nextNodeId, label: branch.label })));
      if (node.defaultNextNodeId) {
        edges.push({ from: node.id, to: node.defaultNextNodeId, label: "default" });
      }
    }
  }
  for (const [index, edge] of edges.entries()) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push({ code: "edge_endpoint", path: `/edges/${index}`, message: `Edge ${edge.from} -> ${edge.to} references an unknown node.` });
      continue;
    }
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  if (issues.length > 0) return { ok: false, issues };

  const entries = [...nodeIds].filter((id) => incoming.get(id) === 0);
  if (entries.length === 0) {
    issues.push({ code: "entry_missing", path: "/nodes", message: "Plan must have at least one entry node." });
  }
  const visited = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  if (visited.size !== nodeIds.size) {
    issues.push({ code: "unreachable_node", path: "/nodes", message: "Every node must be reachable from an entry node." });
  }

  const indegree = new Map(incoming);
  const dagQueue = [...entries];
  let visitedForDag = 0;
  while (dagQueue.length) {
    const current = dagQueue.shift()!;
    visitedForDag += 1;
    for (const next of outgoing.get(current) ?? []) {
      const nextIndegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) dagQueue.push(next);
    }
  }
  if (visitedForDag !== nodeIds.size) {
    issues.push({ code: "graph_cycle", path: "/edges", message: "Plan graph must be a DAG." });
  }
  return { ok: issues.length === 0, issues };
}

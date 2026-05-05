import { randomUUID } from "node:crypto";

import type {
  AIPlanEdge,
  AIPlanOutput,
  CompiledPlan,
  RuntimeLayer,
  LayerSource,
} from "@chrona/contracts/ai";
import { PlanCompileError, upgradeBlueprintToEditable } from "@chrona/contracts/ai";
import { compileEditablePlan } from "@chrona/domain";

const STABLE_NODE_ID = /^[a-z][a-z0-9_]*$/;
const HIGH_RISK_PATTERN = /\b(send|email|message|calendar|schedule|book|pay|purchase|delete|remove|cancel|modify|update)\b/i;

function compileIssue(path: string, message: string) {
  return { path, message };
}

function branchEdges(nodes: AIPlanOutput["nodes"]): AIPlanEdge[] {
  const result: AIPlanEdge[] = [];
  for (const node of nodes) {
    if (node.type !== "condition") continue;
    for (const branch of node.branches) {
      result.push({ from: node.id, to: branch.nextNodeId, label: branch.label });
    }
    if (node.defaultNextNodeId) {
      result.push({ from: node.id, to: node.defaultNextNodeId, label: "default" });
    }
  }
  return result;
}

function edgeKey(edge: AIPlanEdge) {
  return `${edge.from}->${edge.to}->${edge.label ?? ""}`;
}

function assertDag(nodeIds: string[], edges: AIPlanEdge[]) {
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

function checkHighRiskTasks(nodes: AIPlanOutput["nodes"], edges: AIPlanEdge[]) {
  const issues: Array<{ path: string; message: string }> = [];
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    incoming.get(edge.to)!.push(edge.from);
  }
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (node.type !== "task") continue;
    const haystack = [node.title, node.expectedOutput, node.completionCriteria].filter(Boolean).join(" ");
    if (!HIGH_RISK_PATTERN.test(haystack)) continue;
    const predecessors = incoming.get(node.id) ?? [];
    const hasGate = predecessors.some((candidateId) => {
      const candidate = nodeMap.get(candidateId);
      return candidate?.type === "checkpoint"
        && (candidate.checkpointType === "approve" || candidate.checkpointType === "confirm");
    });
    if (!hasGate) {
      issues.push({
        path: `nodes.${node.id}`,
        message: `High-risk task '${node.id}' must be directly preceded by approve/confirm checkpoint`,
      });
    }
  }

  return issues;
}

function validateBlueprint(input: { blueprint: AIPlanOutput }) {
  const issues: Array<{ path: string; message: string }> = [];
  const seenNodeIds = new Set<string>();

  input.blueprint.nodes.forEach((node, index) => {
    if (!STABLE_NODE_ID.test(node.id)) {
      issues.push(compileIssue(`nodes.${index}.id`, `Node id '${node.id}' must be snake_case`));
    }
    if (seenNodeIds.has(node.id)) {
      issues.push(compileIssue(`nodes.${index}.id`, `Duplicate node id '${node.id}'`));
    }
    seenNodeIds.add(node.id);
  });

  const nodeIds = input.blueprint.nodes.map((node) => node.id);
  const nodeIdSet = new Set(nodeIds);
  input.blueprint.edges.forEach((edge, index) => {
    if (!nodeIdSet.has(edge.from)) {
      issues.push(compileIssue(`edges.${index}.from`, `Unknown source node '${edge.from}'`));
    }
    if (!nodeIdSet.has(edge.to)) {
      issues.push(compileIssue(`edges.${index}.to`, `Unknown target node '${edge.to}'`));
    }
  });

  input.blueprint.nodes.forEach((node, index) => {
    if (node.type !== "condition") return;
    node.branches.forEach((branch, branchIndex) => {
      if (!nodeIdSet.has(branch.nextNodeId)) {
        issues.push(compileIssue(
          `nodes.${index}.branches.${branchIndex}.nextNodeId`,
          `Unknown branch target '${branch.nextNodeId}'`,
        ));
      }
    });
    if (node.defaultNextNodeId && !nodeIdSet.has(node.defaultNextNodeId)) {
      issues.push(compileIssue(
        `nodes.${index}.defaultNextNodeId`,
        `Unknown default branch target '${node.defaultNextNodeId}'`,
      ));
    }
  });

  const semanticEdges = branchEdges(input.blueprint.nodes);
  const uniqueEdges = new Map<string, AIPlanEdge>();
  [...input.blueprint.edges, ...semanticEdges].forEach((edge) => {
    uniqueEdges.set(edgeKey(edge), edge);
  });
  const allEdges = [...uniqueEdges.values()];

  if (issues.length === 0 && !assertDag(nodeIds, allEdges)) {
    issues.push(compileIssue("edges", "Plan graph must be a DAG"));
  }

  issues.push(...checkHighRiskTasks(input.blueprint.nodes, allEdges));

  if (issues.length > 0) {
    throw new PlanCompileError("Plan blueprint compilation failed", issues);
  }
}

/**
 * Compiles a loose AI blueprint (AIPlanOutput) into a CompiledPlan + initial RuntimeLayer.
 * The RuntimeLayer sets entry nodes to "ready"; all others default to "pending".
 */
export function compilePlanBlueprint(input: {
  taskId: string;
  blueprint: AIPlanOutput;
  planId?: string;
  prompt?: string | null;
  generatedBy?: string | null;
  source?: LayerSource;
}): { compiledPlan: CompiledPlan; initialLayer: RuntimeLayer; planId: string } {
  validateBlueprint({ blueprint: input.blueprint });

  const planId = input.planId ?? `plan_${randomUUID().slice(0, 8)}`;
  const editable = upgradeBlueprintToEditable(input.blueprint, planId, 1);
  const compiledPlan = compileEditablePlan(editable);

  // Initial RuntimeLayer: mark entry nodes as ready
  const nodeStates: Record<string, { status: "ready" }> = {};
  for (const entryId of compiledPlan.entryNodeIds) {
    nodeStates[entryId] = { status: "ready" };
  }

  const initialLayer: RuntimeLayer = {
    type: "runtime",
    planId,
    timestamp: new Date().toISOString(),
    layerId: `layer_${randomUUID().slice(0, 12)}`,
    version: 1,
    active: true,
    source: input.source ?? "ai",
    nodeStates,
  };

  return { compiledPlan, initialLayer, planId };
}

/**
 * Compiles a loose AI blueprint (AIPlanOutput) into a new-architecture CompiledPlan.
 */
export function compileBlueprintToCompiledPlan(blueprint: AIPlanOutput): CompiledPlan {
  const planId = `plan_${randomUUID().slice(0, 8)}`;
  const editable = upgradeBlueprintToEditable(blueprint, planId, 1);
  return compileEditablePlan(editable);
}

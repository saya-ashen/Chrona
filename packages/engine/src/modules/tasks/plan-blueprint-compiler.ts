import { randomUUID } from "node:crypto";

import type {
  AIPlanEdge,
  AIPlanOutput,
  AIPlanNode,
  CompiledPlanCompletionPolicy,
  TaskPlanEdge,
  TaskPlanEdgeType,
  TaskPlanGraph,
  TaskPlanNode,
  CompiledPlan,
} from "@chrona/contracts/ai";
import { PlanCompileError, upgradeBlueprintToEditable } from "@chrona/contracts/ai";
import { compileEditablePlan } from "@chrona/domain";

const STABLE_NODE_ID = /^[a-z][a-z0-9_]*$/;
const HIGH_RISK_PATTERN = /\b(send|email|message|calendar|schedule|book|pay|purchase|delete|remove|cancel|modify|update)\b/i;

function compileIssue(path: string, message: string) {
  return { path, message };
}

function deriveExecution(node: AIPlanNode): Pick<
  TaskPlanNode,
  "executionMode" | "requiresHumanInput" | "requiresHumanApproval" | "autoRunnable" | "blockingReason"
> {
  switch (node.type) {
    case "task": {
      const requiresHumanInput = node.executor === "user" || node.mode === "manual";
      return {
        executionMode: requiresHumanInput ? "manual" : "automatic",
        requiresHumanInput,
        requiresHumanApproval: false,
        autoRunnable: !requiresHumanInput,
        blockingReason: requiresHumanInput ? "needs_user_input" : null,
      };
    }
    case "checkpoint": {
      const requiresHumanApproval = node.checkpointType === "approve" || node.checkpointType === "confirm";
      return {
        executionMode: "manual",
        requiresHumanInput: true,
        requiresHumanApproval,
        autoRunnable: false,
        blockingReason: requiresHumanApproval ? "needs_approval" : "needs_user_input",
      };
    }
    case "condition": {
      const requiresHumanInput = node.evaluationBy === "user";
      return {
        executionMode: requiresHumanInput ? "manual" : "automatic",
        requiresHumanInput,
        requiresHumanApproval: false,
        autoRunnable: !requiresHumanInput,
        blockingReason: requiresHumanInput ? "needs_user_input" : null,
      };
    }
    case "wait":
      return {
        executionMode: "automatic",
        requiresHumanInput: false,
        requiresHumanApproval: false,
        autoRunnable: true,
        blockingReason: null,
      };
  }
}

function buildTaskPlanNode(node: AIPlanNode, runtimeId: string): TaskPlanNode {
  const execution = deriveExecution(node);
  switch (node.type) {
    case "task":
      return {
        id: runtimeId,
        localId: node.id,
        type: node.type,
        title: node.title,
        objective: node.expectedOutput ?? node.completionCriteria ?? node.title,
        description: null,
        status: "pending",
        phase: null,
        estimatedMinutes: node.estimatedMinutes ?? null,
        priority: null,
        linkedTaskId: null,
        completionSummary: null,
        metadata: {
          executor: node.executor,
          mode: node.mode,
          expectedOutput: node.expectedOutput,
          completionCriteria: node.completionCriteria,
        },
        ...execution,
      };
    case "checkpoint":
      return {
        id: runtimeId,
        localId: node.id,
        type: node.type,
        title: node.title,
        objective: node.prompt,
        description: null,
        status: "pending",
        phase: null,
        estimatedMinutes: 5,
        priority: null,
        linkedTaskId: null,
        completionSummary: null,
        metadata: {
          checkpointType: node.checkpointType,
          prompt: node.prompt,
          required: node.required,
          options: node.options,
          inputFields: node.inputFields,
        },
        ...execution,
      };
    case "condition":
      return {
        id: runtimeId,
        localId: node.id,
        type: node.type,
        title: node.title,
        objective: node.condition,
        description: null,
        status: "pending",
        phase: null,
        estimatedMinutes: 5,
        priority: null,
        linkedTaskId: null,
        completionSummary: null,
        metadata: {
          condition: node.condition,
          evaluationBy: node.evaluationBy,
          branches: node.branches,
          defaultNextNodeId: node.defaultNextNodeId,
        },
        ...execution,
      };
    case "wait":
      return {
        id: runtimeId,
        localId: node.id,
        type: node.type,
        title: node.title,
        objective: `Wait for: ${node.waitFor}`,
        description: null,
        status: "pending",
        phase: null,
        estimatedMinutes: node.estimatedMinutes ?? node.timeout?.minutes ?? null,
        priority: null,
        linkedTaskId: null,
        completionSummary: null,
        metadata: {
          waitFor: node.waitFor,
          timeout: node.timeout,
        },
        ...execution,
      };
  }
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

function buildCompiledEdges(edges: AIPlanEdge[], localToRuntimeId: Map<string, string>): TaskPlanEdge[] {
  return edges.map((edge, index) => ({
    id: `edge_${index + 1}_${randomUUID()}`,
    fromNodeId: localToRuntimeId.get(edge.from)!,
    toNodeId: localToRuntimeId.get(edge.to)!,
    type: edge.label ? ("depends_on" as TaskPlanEdgeType) : ("sequential" as TaskPlanEdgeType),
    metadata: edge.label ? { label: edge.label, localFromNodeId: edge.from, localToNodeId: edge.to } : {
      localFromNodeId: edge.from,
      localToNodeId: edge.to,
    },
  }));
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

export function compilePlanBlueprint(input: {
  taskId: string;
  blueprint: AIPlanOutput;
  graphId?: string;
  prompt?: string | null;
  generatedBy?: string | null;
  source?: TaskPlanGraph["source"];
  status?: TaskPlanGraph["status"];
  revision?: number;
  now?: string;
}): TaskPlanGraph {
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

  const graphId = input.graphId ?? `graph_${randomUUID()}`;
  const now = input.now ?? new Date().toISOString();
  const localToRuntimeId = new Map<string, string>(
    input.blueprint.nodes.map((node) => [node.id, `${graphId}:node:${node.id}:${randomUUID()}`]),
  );
  const nodes = input.blueprint.nodes.map((node) => buildTaskPlanNode(node, localToRuntimeId.get(node.id)!));
  const edges = buildCompiledEdges(allEdges, localToRuntimeId);

  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outdegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
    outdegree.set(edge.fromNodeId, (outdegree.get(edge.fromNodeId) ?? 0) + 1);
  }

  const completionPolicy: CompiledPlanCompletionPolicy = { type: "all_tasks_completed" };

  return {
    id: graphId,
    taskId: input.taskId,
    status: input.status ?? "draft",
    revision: input.revision ?? 1,
    source: input.source ?? "ai",
    generatedBy: input.generatedBy ?? null,
    prompt: input.prompt ?? null,
    summary: input.blueprint.title,
    changeSummary: null,
    blueprint: input.blueprint,
    completionPolicy,
    entryNodeIds: nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id),
    terminalNodeIds: nodes.filter((node) => (outdegree.get(node.id) ?? 0) === 0).map((node) => node.id),
    createdAt: now,
    updatedAt: now,
    nodes,
    edges,
  };
}

/**
 * Compiles a loose AI blueprint (AIPlanOutput) into a new-architecture CompiledPlan.
 * Uses the domain-layer compileEditablePlan underneath.
 */
export function compileBlueprintToCompiledPlan(blueprint: AIPlanOutput): CompiledPlan {
  const planId = `plan_${randomUUID().slice(0, 8)}`;
  const editable = upgradeBlueprintToEditable(blueprint, planId, 1);
  return compileEditablePlan(editable);
}

import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { getAcceptedCompiledPlan, getLatestCompiledPlan, type SavedCompiledPlan } from "./compiled-plan-store";
import { getLayers } from "./plan-run-store";

type LegacyTaskPlanGraphPayload = {
  type: "task_plan_graph_v1";
  status?: string;
  revision?: number;
  prompt?: string | null;
  summary?: string | null;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
};

export type SavedAiPlanSnapshot = {
  id: string;
  status: SavedCompiledPlan["status"];
  prompt: string | null;
  revision: number;
  summary: string | null;
  updatedAt: string;
  plan: Record<string, unknown>;
};

function normalizeSavedPlanStatus(status: unknown): SavedCompiledPlan["status"] {
  return status === "accepted" || status === "superseded" || status === "archived"
    ? status
    : "draft";
}

function parseLegacyTaskPlanGraph(content: string): LegacyTaskPlanGraphPayload | null {
  try {
    const parsed = JSON.parse(content) as LegacyTaskPlanGraphPayload;
    return parsed.type === "task_plan_graph_v1" ? parsed : null;
  } catch {
    return null;
  }
}

function deriveLegacyNodeMetadata(input: {
  node: Record<string, unknown>;
  dependencies: string[];
}) {
  const requiresHumanApproval = input.node.requiresHumanApproval === true;
  const requiresHumanInput = input.node.requiresHumanInput === true;
  const autoRunnable = input.node.autoRunnable === true;

  const executionClassification = requiresHumanApproval
    ? "review_gate"
    : requiresHumanInput
      ? "human_dependent"
      : autoRunnable
        ? "automatic_standalone"
        : "automatic_chainable";

  const readiness = requiresHumanApproval
    ? "waiting"
    : requiresHumanInput
      ? "blocked"
      : input.dependencies.length > 0
        ? "blocked"
        : autoRunnable
          ? "ready"
          : "waiting";

  const nextAction = requiresHumanApproval
    ? "Review and approve this step's output before continuing"
    : requiresHumanInput
      ? "Provide required information to proceed"
      : input.dependencies.length > 0
        ? "Blocked: resolve dependencies first"
        : autoRunnable
          ? "Ready to auto-start"
          : null;

  return { executionClassification, readiness, nextAction };
}

function toLegacySavedAiPlanSnapshot(memory: {
  id: string;
  updatedAt: Date;
  content: string;
}): SavedAiPlanSnapshot | null {
  const parsed = parseLegacyTaskPlanGraph(memory.content);
  if (!parsed) return null;

  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const dependenciesByNodeId = new Map<string, string[]>();

  for (const edge of edges) {
    const toNodeId = typeof edge.toNodeId === "string" ? edge.toNodeId : null;
    const fromNodeId = typeof edge.fromNodeId === "string" ? edge.fromNodeId : null;
    if (!toNodeId || !fromNodeId) continue;
    const deps = dependenciesByNodeId.get(toNodeId) ?? [];
    deps.push(fromNodeId);
    dependenciesByNodeId.set(toNodeId, deps);
  }

  return {
    id: memory.id,
    status: normalizeSavedPlanStatus(parsed.status),
    prompt: typeof parsed.prompt === "string" ? parsed.prompt : null,
    revision: typeof parsed.revision === "number" ? parsed.revision : 1,
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
    updatedAt: memory.updatedAt.toISOString(),
    plan: {
      id: memory.id,
      status: normalizeSavedPlanStatus(parsed.status),
      nodes: nodes.map((node) => {
        const nodeId = typeof node.id === "string" ? node.id : "";
        const dependencies = dependenciesByNodeId.get(nodeId) ?? [];
        return {
          ...node,
          dependencies,
          ...deriveLegacyNodeMetadata({ node, dependencies }),
        };
      }),
      edges,
    },
  };
}

function mapCompiledExecutionClassification(node: {
  type: string;
  ready: boolean;
  status: string;
  blockedReason?: string | null;
}): "automatic_chainable" | "automatic_standalone" | "human_dependent" | "review_gate" {
  if (node.status === "waiting_for_approval") return "review_gate";
  if (node.status === "waiting_for_user") return "human_dependent";
  if (node.type === "checkpoint" && node.blockedReason === "needs_approval") return "review_gate";
  if (node.type === "checkpoint" && node.blockedReason === "needs_user_input") return "human_dependent";
  return node.ready ? "automatic_standalone" : "automatic_chainable";
}

function mapCompiledReadiness(status: string): "ready" | "blocked" | "waiting" {
  if (status === "ready") return "ready";
  if (status === "waiting_for_user" || status === "waiting_for_approval") return "waiting";
  return "blocked";
}

function mapCompiledNextAction(input: {
  status: string;
  ready: boolean;
  blockedReason?: string | null;
}): string | null {
  if (input.ready) return "Ready to auto-start";
  if (input.status === "waiting_for_approval" || input.blockedReason === "needs_approval") {
    return "Review and approve this step's output before continuing";
  }
  if (input.status === "waiting_for_user" || input.blockedReason === "needs_user_input") {
    return "Provide required information to proceed";
  }
  if (input.blockedReason) {
    return `Blocked: ${input.blockedReason}`;
  }
  return null;
}

async function toCompiledSavedAiPlanSnapshot(saved: SavedCompiledPlan): Promise<SavedAiPlanSnapshot> {
  const layers = await getLayers(saved.taskId, saved.compiledPlan.editablePlanId);
  const effective = resolveEffectivePlanGraph(saved.compiledPlan, layers);

  return {
    id: saved.compiledPlan.editablePlanId,
    status: saved.status,
    prompt: saved.prompt,
    revision: saved.compiledPlan.sourceVersion,
    summary: saved.summary,
    updatedAt: saved.updatedAt,
    plan: {
      id: saved.compiledPlan.editablePlanId,
      status: saved.status,
      title: saved.compiledPlan.title,
      goal: saved.compiledPlan.goal,
      nodes: effective.nodes.map((node) => ({
        id: node.id,
        localId: node.localId,
        type: node.type,
        title: node.title,
        description: node.description ?? null,
        status: node.status,
        priority: node.priority ?? null,
        estimatedMinutes: node.estimatedMinutes ?? null,
        linkedTaskId: node.linkedTaskId ?? null,
        dependencies: node.dependencies,
        executionClassification: mapCompiledExecutionClassification(node),
        readiness: mapCompiledReadiness(node.status),
        nextAction: mapCompiledNextAction(node),
      })),
      edges: effective.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.from,
        toNodeId: edge.to,
        type: edge.label ?? "sequential",
      })),
    },
  };
}

export async function getLatestSavedAiPlanSnapshot(taskId: string): Promise<SavedAiPlanSnapshot | null> {
  const savedCompiled = (await getAcceptedCompiledPlan(taskId)) ?? (await getLatestCompiledPlan(taskId));
  if (savedCompiled) {
    return toCompiledSavedAiPlanSnapshot(savedCompiled);
  }

  const memories = await db.memory.findMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      content: true,
      updatedAt: true,
    },
  });

  for (const memory of memories) {
    const snapshot = toLegacySavedAiPlanSnapshot(memory);
    if (snapshot) return snapshot;
  }

  return null;
}

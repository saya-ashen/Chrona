import { MemoryScope, MemorySourceType, MemoryStatus, type Memory } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type {
  SavedTaskPlanGraph,
  TaskPlanEdge,
  TaskPlanGraph,
  TaskPlanNode,
  TaskPlanNodeBlockingReason,
  TaskPlanNodeStatus,
  TaskPlanNodeType,
  TaskPlanStatus,
} from "@/modules/ai/types";

type StoredTaskPlanGraphPayload = {
  type: "task_plan_graph_v1";
  status: TaskPlanStatus;
  revision: number;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  prompt: string | null;
  summary: string | null;
  changeSummary: string | null;
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
};

type PlanRecord = Pick<Memory, "id" | "taskId" | "workspaceId" | "content" | "createdAt" | "updatedAt">;

function normalizePriority(value: unknown): "Low" | "Medium" | "High" | "Urgent" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  if (normalized === "urgent") return "Urgent";
  return null;
}

function normalizeNodeType(value: unknown): TaskPlanNodeType {
  switch (value) {
    case "task":
    case "checkpoint":
    case "condition":
    case "wait":
      return value;
    // Legacy type mappings
    case "step":
    case "deliverable":
    case "tool_action":
      return "task";
    case "decision":
      return "condition";
    case "user_input":
      return "checkpoint";
    default:
      return "task";
  }
}

function normalizeNodeStatus(value: unknown): TaskPlanNodeStatus {
  switch (value) {
    case "in_progress":
    case "waiting_for_child":
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
    case "done":
    case "skipped":
      return value;
    default:
      return "pending";
  }
}

function normalizePlanStatus(value: unknown): TaskPlanStatus {
  switch (value) {
    case "accepted":
    case "superseded":
    case "archived":
      return value;
    default:
      return "draft";
  }
}

function normalizeExecutionClassification(value: unknown): TaskPlanNode["executionClassification"] {
  switch (value) {
    case "automatic_chainable":
    case "automatic_standalone":
    case "human_dependent":
    case "review_gate":
      return value;
    default:
      return undefined;
  }
}

function normalizeReadiness(value: unknown): TaskPlanNode["readiness"] {
  switch (value) {
    case "ready":
    case "blocked":
    case "waiting":
      return value;
    default:
      return undefined;
  }
}

function normalizeBlockingReason(value: unknown): TaskPlanNodeBlockingReason {
  switch (value) {
    case "needs_user_input":
    case "needs_approval":
    case "external_dependency":
      return value;
    default:
      return null;
  }
}

function buildSavedTaskPlanGraph(memory: PlanRecord, payload: StoredTaskPlanGraphPayload): SavedTaskPlanGraph | null {
  if (!memory.taskId) {
    return null;
  }

  const plan: TaskPlanGraph = {
    id: memory.id,
    taskId: memory.taskId,
    status: normalizePlanStatus(payload.status),
    revision: typeof payload.revision === "number" && Number.isFinite(payload.revision) ? payload.revision : 1,
    source: payload.source === "user" || payload.source === "mixed" ? payload.source : "ai",
    generatedBy: typeof payload.generatedBy === "string" && payload.generatedBy.trim().length > 0 ? payload.generatedBy : null,
    prompt: typeof payload.prompt === "string" && payload.prompt.trim().length > 0 ? payload.prompt.trim() : null,
    summary: typeof payload.summary === "string" && payload.summary.trim().length > 0 ? payload.summary.trim() : null,
    changeSummary:
      typeof payload.changeSummary === "string" && payload.changeSummary.trim().length > 0
        ? payload.changeSummary.trim()
        : null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    nodes: Array.isArray(payload.nodes)
      ? payload.nodes.map((node, index) => ({
          id: typeof node.id === "string" && node.id.trim().length > 0 ? node.id : `node-${index + 1}`,
          type: normalizeNodeType(node.type),
          title: typeof node.title === "string" && node.title.trim().length > 0 ? node.title.trim() : `Step ${index + 1}`,
          objective:
            typeof node.objective === "string" && node.objective.trim().length > 0
              ? node.objective.trim()
              : typeof node.title === "string" && node.title.trim().length > 0
                ? node.title.trim()
                : `Step ${index + 1}`,
          description: typeof node.description === "string" && node.description.trim().length > 0 ? node.description.trim() : null,
          status: normalizeNodeStatus(node.status),
          phase: typeof node.phase === "string" && node.phase.trim().length > 0 ? node.phase.trim() : null,
          estimatedMinutes:
            typeof node.estimatedMinutes === "number" && Number.isFinite(node.estimatedMinutes)
              ? node.estimatedMinutes
              : null,
          priority: normalizePriority(node.priority),
          executionMode:
            node.executionMode === "automatic" || node.executionMode === "manual" || node.executionMode === "hybrid"
              ? node.executionMode
              : "automatic",
          requiresHumanInput: Boolean(node.requiresHumanInput),
          requiresHumanApproval: Boolean(node.requiresHumanApproval),
          autoRunnable: Boolean(node.autoRunnable),
          blockingReason: normalizeBlockingReason(node.blockingReason),
          linkedTaskId:
            typeof node.linkedTaskId === "string" && node.linkedTaskId.trim().length > 0 ? node.linkedTaskId : null,
          completionSummary:
            typeof node.completionSummary === "string" && node.completionSummary.trim().length > 0
              ? node.completionSummary.trim()
              : null,
          metadata: node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
            ? (node.metadata as Record<string, unknown>)
            : null,
          requiredInfo:
            Array.isArray((node as Record<string, unknown>).requiredInfo)
              ? ((node as Record<string, unknown>).requiredInfo as string[]).filter((v: unknown) => typeof v === "string")
              : undefined,
          dependencies:
            Array.isArray((node as Record<string, unknown>).dependencies)
              ? ((node as Record<string, unknown>).dependencies as string[]).filter((v: unknown) => typeof v === "string")
              : undefined,
          executionClassification: normalizeExecutionClassification(
            (node as Record<string, unknown>).executionClassification,
          ),
          nextAction:
            typeof (node as Record<string, unknown>).nextAction === "string"
              ? (node as Record<string, unknown>).nextAction as string
              : undefined,
          readiness: normalizeReadiness((node as Record<string, unknown>).readiness),
        }))
      : [],
    edges: Array.isArray(payload.edges)
      ? payload.edges
          .filter((edge): edge is TaskPlanEdge => Boolean(edge && typeof edge === "object"))
          .map((edge, index) => ({
            id: typeof edge.id === "string" && edge.id.trim().length > 0 ? edge.id : `edge-${index + 1}`,
            fromNodeId: edge.fromNodeId,
            toNodeId: edge.toNodeId,
            type:
              edge.type === "depends_on"
                ? edge.type
                : "sequential",
            metadata: edge.metadata && typeof edge.metadata === "object" && !Array.isArray(edge.metadata)
              ? (edge.metadata as Record<string, unknown>)
              : null,
          }))
      : [],
  };

  return {
    id: memory.id,
    taskId: memory.taskId,
    workspaceId: memory.workspaceId,
    status: plan.status,
    prompt: plan.prompt,
    revision: plan.revision,
    summary: plan.summary,
    changeSummary: plan.changeSummary,
    source: plan.source,
    generatedBy: plan.generatedBy,
    plan,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

function parseTaskPlanMemory(memory: PlanRecord): SavedTaskPlanGraph | null {
  try {
    const parsed = JSON.parse(memory.content) as StoredTaskPlanGraphPayload;
    if (parsed.type === "task_plan_graph_v1") {
      return buildSavedTaskPlanGraph(memory, parsed);
    }
    return null;
  } catch {
    return null;
  }
}

function serializeTaskPlanGraph(input: {
  plan: TaskPlanGraph;
  prompt?: string | null;
  status?: TaskPlanStatus;
  revision?: number;
  summary?: string | null;
  changeSummary?: string | null;
  source?: "ai" | "user" | "mixed";
  generatedBy?: string | null;
}) {
  const payload: StoredTaskPlanGraphPayload = {
    type: "task_plan_graph_v1",
    status: input.status ?? input.plan.status ?? "draft",
    revision: input.revision ?? input.plan.revision ?? 1,
    source: input.source ?? input.plan.source ?? "ai",
    generatedBy: input.generatedBy ?? input.plan.generatedBy ?? null,
    prompt: input.prompt?.trim() ? input.prompt.trim() : input.plan.prompt ?? null,
    summary: input.summary?.trim() ? input.summary.trim() : input.plan.summary ?? null,
    changeSummary:
      input.changeSummary?.trim() ? input.changeSummary.trim() : input.plan.changeSummary ?? null,
    nodes: input.plan.nodes,
    edges: input.plan.edges,
  };

  return JSON.stringify(payload);
}

async function findTaskPlanMemories(taskId: string) {
  return db.memory.findMany({
    where: {
      taskId,
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function getLatestTaskPlanGraph(taskId: string) {
  const memories = await findTaskPlanMemories(taskId);
  for (const memory of memories) {
    const parsed = parseTaskPlanMemory(memory);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export async function getAcceptedTaskPlanGraph(taskId: string) {
  const memories = await findTaskPlanMemories(taskId);
  for (const memory of memories) {
    const parsed = parseTaskPlanMemory(memory);
    if (parsed?.status === "accepted") {
      return parsed;
    }
  }
  return null;
}

export async function supersedeOlderTaskPlanGraphs(input: { taskId: string; excludePlanId?: string | null }) {
  const memories = await findTaskPlanMemories(input.taskId);
  const toSupersede = memories
    .filter((memory) => memory.id !== input.excludePlanId)
    .map((memory) => ({ memory, parsed: parseTaskPlanMemory(memory) }))
    .filter((entry) => entry.parsed?.status === "accepted");

  await Promise.all(
    toSupersede.map(({ memory, parsed }) =>
      db.memory.update({
        where: { id: memory.id },
        data: {
          content: serializeTaskPlanGraph({
            plan: parsed!.plan,
            prompt: parsed!.prompt,
            status: "superseded",
            revision: parsed!.revision,
            summary: parsed!.summary,
            changeSummary: parsed!.changeSummary,
            source: parsed!.source,
            generatedBy: parsed!.generatedBy,
          }),
          confidence: 0.4,
        },
      }),
    ),
  );
}

export async function saveTaskPlanGraph(input: {
  workspaceId: string;
  taskId: string;
  plan: TaskPlanGraph;
  prompt?: string | null;
  status?: TaskPlanStatus;
  source?: "ai" | "user" | "mixed";
  generatedBy?: string | null;
  summary?: string | null;
  changeSummary?: string | null;
}) {
  const current = await getLatestTaskPlanGraph(input.taskId);
  const nextRevision = (current?.revision ?? 0) + 1;
  const plan = input.plan;

  const currentMemories = await findTaskPlanMemories(input.taskId);
  const activeGraphMemories = currentMemories
    .map((memory) => ({ memory, parsed: parseTaskPlanMemory(memory) }))
    .filter((entry) => entry.parsed !== null)
    .map((entry) => entry.memory.id);

  if (activeGraphMemories.length > 0) {
    await db.memory.updateMany({
      where: { id: { in: activeGraphMemories } },
      data: { status: MemoryStatus.Inactive },
    });
  }

  const created = await db.memory.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      content: serializeTaskPlanGraph({
        plan: {
          ...plan,
          revision: plan.revision || nextRevision,
          status: input.status ?? plan.status ?? "draft",
          source: input.source ?? plan.source ?? "ai",
          generatedBy: input.generatedBy ?? plan.generatedBy ?? null,
          prompt: input.prompt?.trim() ? input.prompt.trim() : plan.prompt,
          summary: input.summary?.trim() ? input.summary.trim() : plan.summary,
          changeSummary:
            input.changeSummary?.trim() ? input.changeSummary.trim() : plan.changeSummary,
        },
        prompt: input.prompt ?? plan.prompt,
        status: input.status ?? plan.status,
        revision: plan.revision || nextRevision,
        summary: input.summary ?? plan.summary,
        changeSummary: input.changeSummary ?? plan.changeSummary,
        source: input.source ?? plan.source,
        generatedBy: input.generatedBy ?? plan.generatedBy,
      }),
      scope: MemoryScope.task,
      sourceType: MemorySourceType.agent_inferred,
      status: MemoryStatus.Active,
      confidence: (input.status ?? plan.status) === "accepted" ? 1 : 0.7,
    },
  });

  return parseTaskPlanMemory(created)!;
}

export async function acceptTaskPlanGraph(input: { planId: string; taskId: string }) {
  const memory = await db.memory.findUniqueOrThrow({ where: { id: input.planId } });
  const parsed = parseTaskPlanMemory(memory);
  if (!parsed || parsed.taskId !== input.taskId) {
    throw new Error("Task plan graph not found");
  }

  await supersedeOlderTaskPlanGraphs({ taskId: input.taskId, excludePlanId: input.planId });

  const updated = await db.memory.update({
    where: { id: input.planId },
    data: {
      content: serializeTaskPlanGraph({
        plan: parsed.plan,
        prompt: parsed.prompt,
        status: "accepted",
        revision: parsed.revision,
        summary: parsed.summary,
        changeSummary: parsed.changeSummary,
        source: parsed.source,
        generatedBy: parsed.generatedBy,
      }),
      confidence: 1,
    },
  });

  return parseTaskPlanMemory(updated)!;
}

export function getReadyAutoRunnableNodes(graph: TaskPlanGraph): TaskPlanNode[] {
  const completedNodeIds = new Set(
    graph.nodes.filter(n => n.status === "done" || n.status === "skipped").map(n => n.id)
  );
  
  const incomingEdges = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!incomingEdges.has(edge.toNodeId)) {
      incomingEdges.set(edge.toNodeId, []);
    }
    incomingEdges.get(edge.toNodeId)!.push(edge.fromNodeId);
  }
  
  return graph.nodes.filter(node => {
    if (node.status !== "pending") return false;
    if (!node.autoRunnable) return false;
    if (node.requiresHumanInput || node.requiresHumanApproval) return false;
    const deps = incomingEdges.get(node.id) ?? [];
    return deps.every(depId => completedNodeIds.has(depId));
  });
}

export function enrichPlanGraphNodes(graph: TaskPlanGraph): TaskPlanGraph {
  const incomingMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!incomingMap.has(edge.toNodeId)) {
      incomingMap.set(edge.toNodeId, []);
    }
    incomingMap.get(edge.toNodeId)!.push(edge.fromNodeId);
  }

  const enrichedNodes = graph.nodes.map((node) => {
    const deps = incomingMap.get(node.id) ?? [];
    const hasDeps = deps.length > 0;

    let executionClassification: TaskPlanNode["executionClassification"] = "automatic_standalone";
    if (node.requiresHumanInput) {
      executionClassification = "human_dependent";
    } else if (node.requiresHumanApproval) {
      executionClassification = "review_gate";
    } else if (hasDeps) {
      executionClassification = "automatic_chainable";
    }

    let nextAction: string | null = null;
    if (node.requiresHumanInput) {
      nextAction = "Provide required information to proceed";
    } else if (node.requiresHumanApproval) {
      nextAction = "Review and approve this step's output before continuing";
    } else if (node.blockingReason === "external_dependency") {
      nextAction = "Resolve external dependency before this step can start";
    } else if (!node.autoRunnable) {
      nextAction = "This step requires manual start";
    } else if (!hasDeps) {
      nextAction = "Ready to auto-start";
    } else {
      nextAction = "Will auto-start after dependencies complete";
    }

    let readiness: TaskPlanNode["readiness"] = "ready";
    if (node.blockingReason || node.status === "blocked") {
      readiness = "blocked";
    } else if (hasDeps && node.status === "pending") {
      readiness = "waiting";
    }

    return {
      ...node,
      dependencies: deps.length > 0 ? deps : undefined,
      executionClassification,
      nextAction,
      readiness,
    };
  });

  return { ...graph, nodes: enrichedNodes };
}

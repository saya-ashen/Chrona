import { MemoryScope, MemorySourceType, MemoryStatus, type Memory } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type {
  SavedTaskPlanGraph,
  TaskDecompositionResult,
  TaskPlanEdge,
  TaskPlanGraph,
  TaskPlanNode,
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
    case "checkpoint":
    case "decision":
    case "user_input":
    case "deliverable":
    case "tool_action":
      return value;
    default:
      return "step";
  }
}

function normalizeNodeStatus(value: unknown): TaskPlanNodeStatus {
  switch (value) {
    case "in_progress":
    case "waiting_for_user":
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
            node.executionMode === "child_task" || node.executionMode === "inline_action"
              ? node.executionMode
              : "none",
          linkedTaskId:
            typeof node.linkedTaskId === "string" && node.linkedTaskId.trim().length > 0 ? node.linkedTaskId : null,
          needsUserInput: Boolean(node.needsUserInput),
          metadata: node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
            ? (node.metadata as Record<string, unknown>)
            : null,
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
              edge.type === "depends_on" ||
              edge.type === "branches_to" ||
              edge.type === "unblocks" ||
              edge.type === "feeds_output"
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

function inferGraphSummary(result: TaskDecompositionResult) {
  return `${result.subtasks.length} planned item${result.subtasks.length === 1 ? "" : "s"}`;
}

function inferNodeTypeFromSubtask(subtask: TaskDecompositionResult["subtasks"][number]): TaskPlanNodeType {
  const text = `${subtask.title} ${subtask.description ?? ""}`.toLowerCase();
  if (/(wait|confirm|approval|user input|ask user|need user|确认|审批|等待|用户)/.test(text)) {
    return "user_input";
  }
  if (/(check|verify|review|validate|确认结果|检查|校验|复核)/.test(text)) {
    return "checkpoint";
  }
  if (/(report|draft|deliver|output|memo|summary|artifact|报告|草稿|输出|摘要)/.test(text)) {
    return "deliverable";
  }
  return "step";
}

function inferExecutionModeFromSubtask(subtask: TaskDecompositionResult["subtasks"][number]) {
  const type = inferNodeTypeFromSubtask(subtask);
  return type === "step" || type === "deliverable" ? "child_task" : "none";
}

export function decompositionResultToTaskPlanGraph(input: {
  taskId: string;
  result: TaskDecompositionResult;
  status?: TaskPlanStatus;
  revision?: number;
  source?: "ai" | "user" | "mixed";
  generatedBy?: string | null;
  prompt?: string | null;
  summary?: string | null;
  changeSummary?: string | null;
}): TaskPlanGraph {
  const orderedSubtasks = [...input.result.subtasks].sort((a, b) => a.order - b.order);
  const nodes: TaskPlanNode[] = orderedSubtasks.map((subtask, index) => {
    const inferredType = inferNodeTypeFromSubtask(subtask);
    return {
      id: `node-${index + 1}`,
      type: inferredType,
      title: subtask.title,
      objective: subtask.description?.trim() || subtask.title,
      description: subtask.description ?? null,
      status: inferredType === "user_input" ? "waiting_for_user" : "pending",
      phase: inferredType,
      estimatedMinutes: subtask.estimatedMinutes,
      priority: normalizePriority(subtask.priority) ?? "Medium",
      executionMode: inferExecutionModeFromSubtask(subtask),
      linkedTaskId: null,
      needsUserInput: inferredType === "user_input",
      metadata: {
        order: subtask.order,
        dependsOnPrevious: subtask.dependsOnPrevious,
        warnings: input.result.warnings,
        feasibilityScore: input.result.feasibilityScore,
        totalEstimatedMinutes: input.result.totalEstimatedMinutes,
      },
    };
  });

  const edges: TaskPlanEdge[] = [];
  orderedSubtasks.forEach((subtask, index) => {
    if (index === 0 || !subtask.dependsOnPrevious) return;
    edges.push({
      id: `edge-${index}`,
      fromNodeId: nodes[index - 1]!.id,
      toNodeId: nodes[index]!.id,
      type: "sequential",
      metadata: null,
    });
  });

  const now = new Date().toISOString();
  return {
    id: `graph-${input.taskId}-${input.revision ?? 1}`,
    taskId: input.taskId,
    status: input.status ?? "draft",
    revision: input.revision ?? 1,
    source: input.source ?? "ai",
    generatedBy: input.generatedBy ?? null,
    prompt: input.prompt?.trim() ? input.prompt.trim() : null,
    summary: input.summary?.trim() ? input.summary.trim() : inferGraphSummary(input.result),
    changeSummary: input.changeSummary?.trim() ? input.changeSummary.trim() : null,
    createdAt: now,
    updatedAt: now,
    nodes,
    edges,
  };
}

export function taskPlanGraphToDecompositionResult(plan: TaskPlanGraph): TaskDecompositionResult {
  const edgesByToNode = new Set(plan.edges.filter((edge) => edge.type === "sequential").map((edge) => edge.toNodeId));
  const orderedNodes = [...plan.nodes].sort((a, b) => {
    const orderA = typeof a.metadata?.order === "number" ? a.metadata.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.metadata?.order === "number" ? b.metadata.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });

  const subtasks = orderedNodes.map((node, index) => ({
    title: node.title,
    description: node.description ?? undefined,
    estimatedMinutes: node.estimatedMinutes ?? 0,
    priority: node.priority ?? "Medium",
    order: typeof node.metadata?.order === "number" ? node.metadata.order : index + 1,
    dependsOnPrevious: edgesByToNode.has(node.id),
  }));

  const totalEstimatedMinutesFromMetadata = orderedNodes.find(
    (node) => typeof node.metadata?.totalEstimatedMinutes === "number",
  )?.metadata?.totalEstimatedMinutes;
  const feasibilityFromMetadata = orderedNodes.find(
    (node) => typeof node.metadata?.feasibilityScore === "number",
  )?.metadata?.feasibilityScore;
  const warningsFromMetadata = orderedNodes.find((node) => Array.isArray(node.metadata?.warnings))?.metadata?.warnings;

  return {
    subtasks,
    totalEstimatedMinutes:
      typeof totalEstimatedMinutesFromMetadata === "number"
        ? totalEstimatedMinutesFromMetadata
        : subtasks.reduce((sum, subtask) => sum + (subtask.estimatedMinutes ?? 0), 0),
    feasibilityScore: typeof feasibilityFromMetadata === "number" ? feasibilityFromMetadata : 0,
    warnings: Array.isArray(warningsFromMetadata)
      ? warningsFromMetadata.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
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
  plan?: TaskPlanGraph;
  decompositionResult?: TaskDecompositionResult;
  prompt?: string | null;
  status?: TaskPlanStatus;
  source?: "ai" | "user" | "mixed";
  generatedBy?: string | null;
  summary?: string | null;
  changeSummary?: string | null;
}) {
  const current = await getLatestTaskPlanGraph(input.taskId);
  const nextRevision = (current?.revision ?? 0) + 1;
  const plan =
    input.plan ??
    decompositionResultToTaskPlanGraph({
      taskId: input.taskId,
      result: input.decompositionResult!,
      status: input.status ?? "draft",
      revision: nextRevision,
      source: input.source ?? "ai",
      generatedBy: input.generatedBy ?? null,
      prompt: input.prompt ?? null,
      summary: input.summary ?? null,
      changeSummary: input.changeSummary ?? null,
    });

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

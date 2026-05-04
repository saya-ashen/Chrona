import { db } from "@/lib/db";
import { createLogger, summarizeText } from "@/lib/logger";
import { aiGeneratePlan } from "@/modules/ai/ai-service";
import type { TaskPlanGraph, TaskPlanGraphResponse, TaskPlanStatus } from "@/modules/ai/types";
import { getLatestTaskPlanGraph, saveTaskPlanGraph, enrichPlanGraphNodes } from "@/modules/tasks/task-plan-graph-store";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import type { GenerateTaskPlanResponse } from "@chrona/ai-features";

const logger = createLogger("command.generate-task-plan-for-task");

export type GenerateTaskPlanForTaskResult = TaskPlanGraphResponse & {
  reasoning?: string;
};

function buildSavedPlanSummary(savedPlan: {
  id: string;
  status: TaskPlanStatus;
  prompt: string | null;
  revision: number;
  summary: string | null;
  updatedAt: string;
}) {
  return {
    id: savedPlan.id,
    status: savedPlan.status,
    prompt: savedPlan.prompt,
    revision: savedPlan.revision,
    summary: savedPlan.summary,
    updatedAt: savedPlan.updatedAt,
  };
}

function buildDraftPlanGraph(input: {
  taskId: string;
  prompt: string | null;
  generatedBy: string;
  planResult: GenerateTaskPlanResponse;
}) {
  const now = new Date().toISOString();
  const graph: TaskPlanGraph = {
    id: `graph-${input.taskId || "adhoc"}-${Date.now()}`,
    taskId: input.taskId,
    status: "draft",
    revision: 1,
    source: "ai",
    generatedBy: input.generatedBy,
    prompt: input.prompt,
    summary: input.planResult.summary,
    changeSummary: null,
    createdAt: now,
    updatedAt: now,
    nodes: input.planResult.nodes,
    edges: input.planResult.edges,
  };
  return enrichPlanGraphNodes(graph);
}

function buildPlanResponse(input: {
  source: string;
  planGraph: TaskPlanGraph;
  taskSessionKey?: string | null;
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
  reasoning?: string;
}): GenerateTaskPlanForTaskResult {
  return {
    source: input.source,
    planGraph: input.planGraph,
    taskSessionKey: input.taskSessionKey ?? null,
    savedPlan: input.savedPlan,
    reasoning: input.reasoning,
  };
}

export async function generateTaskPlanForTask(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  estimatedMinutes?: number;
  planningPrompt?: string | null;
  forceRefresh?: boolean;
  signal?: AbortSignal;
}) {
  if (input.signal?.aborted) {
    throw new DOMException("Task plan generation aborted", "AbortError");
  }

  const task = await db.task.findUnique({ where: { id: input.taskId } });
  if (!task) {
    throw new Error("Task not found");
  }

  const sharedTaskSessionKey = (
    await ensureDefaultTaskSession({
      taskId: task.id,
      taskTitle: task.title,
      runtimeName: task.runtimeAdapterKey ?? "openclaw",
      defaultSessionId: task.defaultSessionId,
    })
  ).sessionKey;

  if (!input.forceRefresh) {
    const savedPlan = await getLatestTaskPlanGraph(task.id);
    if (savedPlan) {
      return buildPlanResponse({
        source: "saved",
        planGraph: savedPlan.plan,
        taskSessionKey: sharedTaskSessionKey,
        savedPlan: buildSavedPlanSummary(savedPlan),
      });
    }
  }

  if (input.signal?.aborted) {
    throw new DOMException("Task plan generation aborted", "AbortError");
  }

  const estimatedMinutes = typeof input.estimatedMinutes === "number"
    ? input.estimatedMinutes
    : task.scheduledStartAt && task.scheduledEndAt
      ? Math.round((task.scheduledEndAt.getTime() - task.scheduledStartAt.getTime()) / 60000)
      : undefined;
  const title = input.title?.trim() || task.title;
  const description = input.description ?? task.description ?? undefined;

  logger.info("request.start", {
    taskId: task.id,
    title: summarizeText(title),
    forceRefresh: Boolean(input.forceRefresh),
  });

  const planResult = await aiGeneratePlan({
    taskId: task.id,
    title,
    description,
    estimatedMinutes,
    sessionKey: sharedTaskSessionKey,
    signal: input.signal,
  } as Parameters<typeof aiGeneratePlan>[0] & { signal?: AbortSignal });

  if (input.signal?.aborted) {
    throw new DOMException("Task plan generation aborted", "AbortError");
  }

  if (!planResult) {
    logger.warn("request.unavailable", { taskId: task.id });
    return null;
  }

   if (planResult.nodes.length === 0) {
     logger.warn("request.empty_plan", {
       taskId: task.id,
       source: planResult.source,
       summary: summarizeText(planResult.summary),
     });
     return null;
   }

  const draftPlan = buildDraftPlanGraph({
    taskId: task.id,
    prompt: input.planningPrompt ?? null,
    generatedBy: planResult.source ?? "ai",
    planResult,
  });
  const savedPlan = await saveTaskPlanGraph({
    workspaceId: task.workspaceId,
    taskId: task.id,
    plan: draftPlan,
    prompt: input.planningPrompt ?? null,
    status: "draft",
    source: "ai",
    generatedBy: planResult.source ?? "ai",
    summary: planResult.summary,
  });

  logger.info("request.saved", {
    taskId: task.id,
    savedPlanId: savedPlan.id,
    revision: savedPlan.revision,
  });

  return buildPlanResponse({
    source: planResult.source,
    planGraph: savedPlan.plan,
    taskSessionKey: sharedTaskSessionKey,
    savedPlan: buildSavedPlanSummary(savedPlan),
    reasoning: planResult.reasoning,
  });
}

export function buildAdhocDraftTaskPlan(input: {
  taskId?: string | null;
  planningPrompt?: string | null;
  generatedBy: string;
  planResult: GenerateTaskPlanResponse;
}) {
  return buildDraftPlanGraph({
    taskId: input.taskId ?? "",
    prompt: input.planningPrompt ?? null,
    generatedBy: input.generatedBy,
    planResult: input.planResult,
  });
}

export function buildGenerateTaskPlanResponse(input: {
  source: string;
  planGraph: TaskPlanGraph;
  taskSessionKey?: string | null;
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
  reasoning?: string;
}) {
  return buildPlanResponse(input);
}

export function buildSavedTaskPlanSummary(input: Parameters<typeof buildSavedPlanSummary>[0]) {
  return buildSavedPlanSummary(input);
}

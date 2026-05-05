import { db } from "@/lib/db";
import { createLogger, summarizeText } from "@/lib/logger";
import { aiGeneratePlan } from "@/modules/ai/ai-service";
import type { PlanOverlayLayer, RuntimeLayer } from "@chrona/contracts/ai";
import { saveCompiledPlan, getLatestCompiledPlan, getAcceptedCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { savePlanRun, appendLayer, getLayers } from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/plan-run-bridge";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { ensureDefaultTaskSession } from "@/modules/task-execution/task-sessions";
import type { GenerateTaskPlanResponse } from "@chrona/contracts";
import { compilePlanBlueprint } from "@/modules/tasks/plan-blueprint-compiler";

const logger = createLogger("command.generate-task-plan-for-task");

export type GenerateTaskPlanForTaskResult = {
  planId: string;
  compiledPlanId: string;
  title: string;
  goal: string;
  layers: PlanOverlayLayer[];
  summary: string | null;
};

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
    const savedCompiled = await getLatestCompiledPlan(task.id);
    if (savedCompiled) {
      const layers = await getLayers(task.id, savedCompiled.compiledPlan.editablePlanId);
      const effective = resolveEffectivePlanGraph(savedCompiled.compiledPlan, layers);
      return {
        planId: savedCompiled.compiledPlan.editablePlanId,
        compiledPlanId: savedCompiled.compiledPlan.id,
        title: effective.nodes.length > 0 ? effective.nodes[0].title : "Plan",
        goal: "",
        layers,
        summary: savedCompiled.summary,
      };
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

  if (planResult.blueprint.nodes.length === 0) {
    logger.warn("request.empty_plan", {
      taskId: task.id,
      source: planResult.source,
      summary: summarizeText(planResult.blueprint.title),
    });
    return null;
  }

  const { compiledPlan, initialLayer, planId } = compilePlanBlueprint({
    taskId: task.id,
    blueprint: planResult.blueprint,
    prompt: input.planningPrompt ?? null,
    generatedBy: planResult.source ?? "ai",
    source: "ai",
  });

  // Store compiled plan
  await saveCompiledPlan({
    workspaceId: task.workspaceId,
    taskId: task.id,
    compiledPlan,
    status: "draft",
    prompt: input.planningPrompt ?? null,
    summary: planResult.blueprint.title ?? null,
    generatedBy: planResult.source ?? "ai",
  });

  // Create initial PlanRun with the initial layer
  const initialLayers: PlanOverlayLayer[] = [initialLayer];
  const run = createPlanRunFromCompiledPlan(compiledPlan, initialLayers);
  await savePlanRun({
    workspaceId: task.workspaceId,
    taskId: task.id,
    planId,
    run,
    layers: initialLayers,
  });

  logger.info("request.saved", {
    taskId: task.id,
    planId,
    compiledPlanId: compiledPlan.id,
  });

  return {
    planId,
    compiledPlanId: compiledPlan.id,
    title: compiledPlan.nodes[0]?.title ?? "Plan",
    goal: "",
    layers: initialLayers,
    summary: planResult.blueprint.title ?? null,
  };
}

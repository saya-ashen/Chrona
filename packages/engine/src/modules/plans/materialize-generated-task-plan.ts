import type { PlanBlueprint, TaskPlanReadModel } from "@chrona/contracts";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { compilePlanBlueprint } from "@/modules/plans/plan-blueprint-compiler";
import {
  saveCompiledPlan,
  getLatestCompiledPlan,
} from "@/modules/plan-execution/compiled-plan-store";
import {
  createPlanGraphFromCompiledPlan,
  savePlanRun,
} from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution";
import { buildTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { upgradeBlueprintToEditable } from "@chrona/contracts";

/**
 * Materializes a generated task plan: compiles the AI blueprint, persists
 * the compiled plan + initial PlanRun, resolves the effective graph, and
 * builds the canonical TaskPlanReadModel.
 */
export async function materializeGeneratedTaskPlan(input: {
  taskId: string;
  workspaceId: string;
  blueprint: PlanBlueprint;
  planningPrompt?: string | null;
  generatedBy?: string | null;
}): Promise<TaskPlanReadModel> {
  const { compiledPlan, planId } = compilePlanBlueprint({
    taskId: input.taskId,
    blueprint: input.blueprint,
    generatedBy: input.generatedBy ?? "ai",
    source: "ai",
  });

  await saveCompiledPlan({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    compiledPlan,
    editablePlan: upgradeBlueprintToEditable(input.blueprint, planId, 1),
    status: "draft",
    prompt: input.planningPrompt ?? null,
    summary: input.blueprint.title ?? null,
    generatedBy: input.generatedBy ?? "ai",
  });

  const run = createPlanRunFromCompiledPlan(compiledPlan);
  await savePlanRun({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    planId,
    run,
    compiledPlan,
    graph: createPlanGraphFromCompiledPlan({
      taskId: input.taskId,
      compiledPlan,
    }),
    attempts: [],
    results: [],
    executionContextSnapshots: [],
  });

  const effectivePlanGraph = resolveEffectivePlanGraph({
    graph: createPlanGraphFromCompiledPlan({
      taskId: input.taskId,
      compiledPlan,
    }),
  });

  // Fetch the just-saved record for accurate timestamps
  const saved = await getLatestCompiledPlan(input.taskId);

  return buildTaskPlanReadModel({
    compiledPlan,
    effectivePlanGraph,
    blueprint: input.blueprint,
    status: saved?.status ?? "draft",
    prompt: saved?.prompt ?? input.planningPrompt ?? null,
    summary: saved?.summary ?? input.blueprint.title ?? null,
    generatedBy: saved?.generatedBy ?? input.generatedBy ?? "ai",
    updatedAt: saved?.updatedAt ?? new Date().toISOString(),
  });
}

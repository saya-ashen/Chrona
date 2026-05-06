import type {
  PlanBlueprint,
  TaskPlanReadModel,
} from "@chrona/contracts";
import { resolveEffectivePlanGraph } from "@chrona/domain";
import { compilePlanBlueprint } from "@/modules/tasks/plan-blueprint-compiler";
import { saveCompiledPlan, getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { savePlanRun } from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/plan-runner";
import { buildTaskPlanReadModel } from "@/modules/queries/task-plan-read-model";
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
  const { compiledPlan, initialLayer, planId } = compilePlanBlueprint({
    taskId: input.taskId,
    blueprint: input.blueprint,
    prompt: input.planningPrompt ?? null,
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

  const run = createPlanRunFromCompiledPlan(compiledPlan, [initialLayer]);
  await savePlanRun({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    planId,
    run,
    layers: [initialLayer],
  });

  const effectivePlanGraph = resolveEffectivePlanGraph(compiledPlan, [initialLayer]);

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

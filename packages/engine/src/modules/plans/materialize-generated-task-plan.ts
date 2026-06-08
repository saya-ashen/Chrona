import type { PlanBlueprint, TaskPlanReadModel } from "@chrona/contracts";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { compilePlanBlueprint } from "@/modules/plans/plan-blueprint-compiler";
import { saveCompiledPlan, getLatestCompiledPlan, getAcceptedCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { createPlanGraphFromCompiledPlan, savePlanRun, getPlanRun } from "@/modules/plan-execution/persistence/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution/persistence/plan-runtime-store";
import { buildTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";
import { upgradeBlueprintToEditable } from "@chrona/contracts";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

/**
 * Plan-run statuses that mean the accepted plan is mid-flight. Materializing a
 * fresh plan in these states would create a new "latest" draft that shadows the
 * running plan in every read model (`getLatestTaskPlanReadModel`), so the UI
 * would appear to swap the plan out from under an in-progress execution.
 */
const ACTIVE_PLAN_RUN_STATUSES = new Set(["running", "paused"]);

/**
 * Guard against regenerating a plan while the task's accepted plan is actively
 * executing. Without this, an agent (or a stray `chrona.plan.generate` call)
 * mid-run silently supersedes the running plan and the user sees their plan
 * "refresh" into something else.
 */
async function assertNoActivePlanExecution(input: {
  taskId: string;
  workBlockId?: string | null;
}): Promise<void> {
  const accepted =
    (await getAcceptedCompiledPlan(input.taskId, input.workBlockId ?? null)) ??
    (input.workBlockId ? await getAcceptedCompiledPlan(input.taskId, null) : null);
  if (!accepted) {
    return;
  }

  const run = await getPlanRun(
    input.taskId,
    accepted.compiledPlan.editablePlanId,
    accepted.workBlockId,
  );
  if (!run) {
    return;
  }

  if (ACTIVE_PLAN_RUN_STATUSES.has(run.planRun.status)) {
    throw new EngineError(
      ENGINE_ERROR_CODES.CONFLICT,
      `Cannot generate a new plan while the accepted plan is ${run.planRun.status}. ` +
        "Stop or cancel the current execution before regenerating.",
    );
  }
}

/**
 * Materializes a generated task plan: compiles the AI blueprint, persists
 * the compiled plan + initial PlanRun, resolves the effective graph, and
 * builds the canonical TaskPlanReadModel.
 */
export async function materializeGeneratedTaskPlan(input: {
  taskId: string;
  workBlockId?: string | null;
  workspaceId: string;
  blueprint: PlanBlueprint;
  userInstruction?: string | null;
  generatedBy?: string | null;
}): Promise<TaskPlanReadModel> {
  await assertNoActivePlanExecution({
    taskId: input.taskId,
    workBlockId: input.workBlockId ?? null,
  });

  const { compiledPlan, planId } = compilePlanBlueprint({
    taskId: input.taskId,
    blueprint: input.blueprint,
    generatedBy: input.generatedBy ?? "ai",
    source: "ai",
  });

  await saveCompiledPlan({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId ?? null,
    compiledPlan,
    editablePlan: upgradeBlueprintToEditable(input.blueprint, planId, 1),
    status: "draft",
    prompt: input.userInstruction ?? null,
    summary: input.blueprint.title ?? null,
    generatedBy: input.generatedBy ?? "ai",
  });

  const run = createPlanRunFromCompiledPlan(compiledPlan);
  await savePlanRun({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId ?? null,
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

  // Plan persistence changes the task's read state (it becomes runnable / gains
  // a current node). Rebuild the projection so Schedule/Work surfaces reflect
  // the new plan immediately instead of waiting for the next execution action.
  await rebuildTaskProjection(input.taskId);

  // Fetch the just-saved record for accurate timestamps
  const saved = await getLatestCompiledPlan(input.taskId, input.workBlockId ?? null);

  return buildTaskPlanReadModel({
    compiledPlan,
    effectivePlanGraph,
    blueprint: input.blueprint,
    status: saved?.status ?? "draft",
    prompt: saved?.prompt ?? input.userInstruction ?? null,
    summary: saved?.summary ?? input.blueprint.title ?? null,
    generatedBy: saved?.generatedBy ?? input.generatedBy ?? "ai",
    updatedAt: saved?.updatedAt ?? new Date().toISOString(),
  });
}

import { createLogger } from "@chrona/shared/logger";
import { getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { taskPlanning } from "./task-planning";
import { TaskPlanGenerationInFlightError } from "./task-plan-generation-registry";

const logger = createLogger("engine.plans.auto-generate");

export async function generateAndAcceptTaskPlan(input: { taskId: string; workBlockId?: string | null; accept?: boolean }) {
  const workBlockId = input.workBlockId ?? null;
  const generation = taskPlanning.generate({ taskId: input.taskId, workBlockId });
  let acceptedPlanId: string | null = null;

  try {
    for await (const event of generation.events) {
      generation.emit(event);

      if (event.type === "result") {
        if (input.accept ?? true) {
          const latest = await getLatestCompiledPlan(input.taskId, workBlockId);
          const planId = latest?.compiledPlan.editablePlanId ?? event.result.id;
          await taskPlanning.accept({ taskId: input.taskId, planId, workBlockId });
          acceptedPlanId = planId;
        }

        break;
      }

      if (event.type === "error" || event.type === "cancelled") {
        break;
      }
    }
  } finally {
    generation.finish();
  }

  return { taskId: input.taskId, acceptedPlanId };
}

export function startAutoPlanGenerationForTask(input: { taskId: string; workBlockId?: string | null; accept?: boolean }) {
  void generateAndAcceptTaskPlan(input).catch((cause) => {
    if (cause instanceof TaskPlanGenerationInFlightError) {
      logger.info("auto_plan_generation.skipped_in_flight", { taskId: input.taskId, workBlockId: input.workBlockId ?? null });
      return;
    }

    logger.error("auto_plan_generation.failed", {
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

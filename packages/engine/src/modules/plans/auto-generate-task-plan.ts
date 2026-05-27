import { createLogger } from "@chrona/shared/logger";
import { getLatestCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { taskPlanning } from "./task-planning";
import { TaskPlanGenerationInFlightError } from "./task-plan-generation-registry";

const logger = createLogger("engine.plans.auto-generate");

export async function generateAndAcceptTaskPlan(input: { taskId: string; accept?: boolean }) {
  const generation = taskPlanning.generate({ taskId: input.taskId });
  let acceptedPlanId: string | null = null;

  try {
    for await (const event of generation.events) {
      generation.emit(event);

      if (event.type === "result") {
        if (input.accept ?? true) {
          const latest = await getLatestCompiledPlan(input.taskId);
          const planId = latest?.compiledPlan.editablePlanId ?? event.result.id;
          await taskPlanning.accept({ taskId: input.taskId, planId });
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

export function startAutoPlanGenerationForTask(input: { taskId: string; accept?: boolean }) {
  void generateAndAcceptTaskPlan(input).catch((cause) => {
    if (cause instanceof TaskPlanGenerationInFlightError) {
      logger.info("auto_plan_generation.skipped_in_flight", { taskId: input.taskId });
      return;
    }

    logger.error("auto_plan_generation.failed", {
      taskId: input.taskId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

import { createLogger } from "@chrona/logging";
import { taskPlanning } from "./task-planning";
import { TaskPlanGenerationInFlightError } from "./task-plan-generation-registry";
import { assertSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";
import { runWithSchedulerWorkContext } from "@/modules/orchestration/scheduler-work-context";

const logger = createLogger("engine.plans.auto-generate");

export async function generateAndAcceptTaskPlan(input: {
  taskId: string;
  workBlockId?: string | null;
  accept?: boolean;
  workContext?: SchedulerWorkContext;
}) {
  return runWithSchedulerWorkContext(input.workContext, async () => {
    const workBlockId = input.workBlockId ?? null;
    await assertSchedulerWorkOwnership(input.workContext);
    const generation = await taskPlanning.generate({
      taskId: input.taskId,
      workBlockId,
      idempotencyKey: `auto-plan:${input.taskId}:${workBlockId ?? "default"}`,
      workContext: input.workContext,
    });
    let committed: { planId: string; headStateVersion: number } | null = null;
    let acceptedPlanId: string | null = null;

    try {
      for await (const event of generation.events) {
        await assertSchedulerWorkOwnership(input.workContext);
        if (event.type === "committed") {
          committed = { planId: event.planId, headStateVersion: event.headStateVersion };
        }
        if (event.type === "failed" || event.type === "stale" || event.type === "cancelled") break;
      }

      if (committed && input.accept === true) {
        await taskPlanning.accept({
          taskId: input.taskId,
          planId: committed.planId,
          workBlockId,
          expectedHeadStateVersion: committed.headStateVersion,
          idempotencyKey: `auto-accept:${generation.generationId}`,
          workContext: input.workContext,
        });
        acceptedPlanId = committed.planId;
      }
    } finally {
      generation.finish();
    }

    await assertSchedulerWorkOwnership(input.workContext);
    return { taskId: input.taskId, acceptedPlanId };
  });
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

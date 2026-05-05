import { createLogger } from "@/lib/logger";
import { generateTaskPlanForTask } from "@/modules/commands/generate-task-plan-for-task";
import {
  startTaskPlanGeneration,
  TaskPlanGenerationInFlightError,
} from "@/modules/commands/task-plan-generation-registry";

const logger = createLogger("command.queue-task-plan-generation");

type TaskPlanGenerationReason = "task_created" | "task_updated" | "manual_regenerate";

async function runQueuedTaskPlanGeneration(input: {
  taskId: string;
  reason: TaskPlanGenerationReason;
  planningPrompt?: string | null;
  forceRefresh?: boolean;
}) {
  let lock: ReturnType<typeof startTaskPlanGeneration>;
  try {
    lock = startTaskPlanGeneration(input.taskId);
  } catch (error) {
    if (error instanceof TaskPlanGenerationInFlightError) {
      logger.info("skip.in_flight", { taskId: input.taskId, reason: input.reason });
      return null;
    }
    throw error;
  }

  try {
    const result = await generateTaskPlanForTask({
      taskId: input.taskId,
      planningPrompt: input.planningPrompt,
      forceRefresh: input.forceRefresh ?? input.reason !== "task_created",
      signal: lock.signal,
    });
    logger.info("job.done", {
      taskId: input.taskId,
      reason: input.reason,
      savedPlanId: result?.planId ?? null,
    });
    return result;
  } catch (error) {
    if (error instanceof TaskPlanGenerationInFlightError) {
      logger.info("skip.in_flight", { taskId: input.taskId, reason: input.reason });
      return null;
    }
    logger.error("job.failed", {
      taskId: input.taskId,
      reason: input.reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    lock.finish();
  }
}

export function enqueueTaskPlanGeneration(input: {
  taskId: string;
  reason: TaskPlanGenerationReason;
  planningPrompt?: string | null;
  forceRefresh?: boolean;
}) {
  queueMicrotask(() => {
    void runQueuedTaskPlanGeneration(input);
  });
}

import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

/** Reject AI planning/execution before an AI feature, plan, run, or session is written. */
export async function assertAiTaskExecution(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { taskExecutionMode: true },
  });
  if (task.taskExecutionMode === "manual") {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Manual tasks cannot use AI planning or execution.",
    );
  }
}

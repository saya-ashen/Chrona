import { db } from "@/lib/db";
import { getRuntimeTaskConfigSpec, listExecutionRuntimes } from "@/modules/execution-runtime";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export async function getTaskRuntimeContext(input: { taskId: string }) {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { workspace: { select: { defaultRuntime: true } } },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }

  return {
    defaultExecutionRuntime: task.workspace.defaultRuntime,
    executionRuntimes: listExecutionRuntimes().map((key) => ({
      key,
      label: key,
      spec: getRuntimeTaskConfigSpec(key),
    })),
  };
}

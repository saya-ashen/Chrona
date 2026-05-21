import { db } from "@/lib/db";
import { HERMES_EXECUTION_RUNTIME } from "@chrona/hermes";

export async function getRuntimeName(taskId: string): Promise<string> {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { executionRuntime: true },
  });
  return task.executionRuntime ?? HERMES_EXECUTION_RUNTIME;
}

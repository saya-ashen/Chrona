import { db } from "@/lib/db";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

/** Task creation/editing provider context. Adapter selection is intentionally absent. */
export async function getTaskRuntimeContext(input: {
  taskId: string;
  workBlockId?: string | null;
}) {
  const task = await db.task.findUnique({
    where: { id: input.taskId },
    select: { id: true },
  });
  if (!task) {
    throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Task not found");
  }
  if (input.workBlockId) {
    const ownedWorkBlock = await db.workBlock.findFirst({
      where: { id: input.workBlockId, taskId: input.taskId },
      select: { id: true },
    });
    if (!ownedWorkBlock) {
      throw new EngineError(ENGINE_ERROR_CODES.TASK_NOT_FOUND, "Work block not found");
    }
  }

  const availableAiClients = await db.aiClient.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      type: true,
      isDefault: true,
      enabled: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return { availableAiClients };
}

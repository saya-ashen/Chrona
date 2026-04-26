import { MemoryStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

export async function invalidateMemory(input: { memoryId: string }) {
  const memory = await db.memory.findUniqueOrThrow({ where: { id: input.memoryId } });

  const updated = await db.memory.update({
    where: { id: input.memoryId },
    data: { status: MemoryStatus.Inactive },
  });

  if (memory.taskId) {
    await appendCanonicalEvent({
      eventType: "memory.updated",
      workspaceId: memory.workspaceId,
      taskId: memory.taskId,
      actorType: "user",
      actorId: "server-action",
      source: "ui",
      dedupeKey: `memory.updated:${memory.id}:${updated.updatedAt.toISOString()}`,
      payload: {
        memory_id: memory.id,
        previous_status: memory.status,
        next_status: updated.status,
        invalidated: true,
      },
    });
  }

  return {
    memoryId: updated.id,
    workspaceId: updated.workspaceId,
    taskId: updated.taskId,
  };
}

import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { deriveTaskRunnability } from "@/modules/tasks/derive-task-runnability";

export async function reopenTask(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });
  const runnability = deriveTaskRunnability({
    runtimeModel: task.runtimeModel,
    prompt: task.prompt,
    runtimeConfig: task.runtimeConfig,
  });
  const nextStatus = runnability.isRunnable ? TaskStatus.Ready : TaskStatus.Draft;

  await db.task.update({
    where: { id: task.id },
    data: {
      status: nextStatus,
      completedAt: null,
      blockReason: Prisma.DbNull,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.reopened",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      previous_status: task.status,
      next_status: nextStatus,
    },
    dedupeKey: `task.reopened:${task.id}:${Date.now()}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    status: nextStatus,
  };
}

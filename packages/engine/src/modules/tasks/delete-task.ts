import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";

export async function deleteTask(taskId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true, title: true },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  await appendCanonicalEvent({
    eventType: "task.deleted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: { title: task.title },
    dedupeKey: `task.deleted:${task.id}`,
  });

  await db.$transaction(async (tx) => {
    await tx.taskProjection.deleteMany({ where: { taskId } });
    await tx.run.deleteMany({ where: { taskId } });
    await tx.taskSession.deleteMany({ where: { taskId } });
    await tx.approval.deleteMany({ where: { taskId } });
    await tx.artifact.deleteMany({ where: { taskId } });
    await tx.memory.deleteMany({ where: { taskId } });
    await tx.event.deleteMany({ where: { taskId } });
    await tx.taskDependency.deleteMany({
      where: { OR: [{ taskId }, { dependsOnTaskId: taskId }] },
    });
    await tx.scheduleProposal.deleteMany({ where: { taskId } });

    const childTasks = await tx.task.findMany({
      where: { parentTaskId: taskId },
      select: { id: true },
    });

    for (const child of childTasks) {
      await tx.taskProjection.deleteMany({ where: { taskId: child.id } });
      await tx.run.deleteMany({ where: { taskId: child.id } });
      await tx.taskSession.deleteMany({ where: { taskId: child.id } });
      await tx.approval.deleteMany({ where: { taskId: child.id } });
      await tx.artifact.deleteMany({ where: { taskId: child.id } });
      await tx.memory.deleteMany({ where: { taskId: child.id } });
      await tx.event.deleteMany({ where: { taskId: child.id } });
      await tx.taskDependency.deleteMany({
        where: { OR: [{ taskId: child.id }, { dependsOnTaskId: child.id }] },
      });
      await tx.scheduleProposal.deleteMany({ where: { taskId: child.id } });
      await tx.task.delete({ where: { id: child.id } });
    }

    await tx.task.delete({ where: { id: taskId } });
  });

  return { success: true, taskId };
}

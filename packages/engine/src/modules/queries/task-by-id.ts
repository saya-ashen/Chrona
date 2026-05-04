import { db } from "@/lib/db";

export async function getTaskOrThrow(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId } });
  if (!task) {
    throw new Error("Task not found");
  }
  return task;
}

export async function ensureTaskInWorkspace(taskId: string, workspaceId: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, workspaceId: true },
  });

  if (!task) {
    throw new Error("Task not found");
  }

  if (task.workspaceId !== workspaceId) {
    throw new Error("Task not found");
  }

  return task;
}

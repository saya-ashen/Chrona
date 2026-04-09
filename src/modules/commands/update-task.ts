import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
}) {
  const changedFields = [
    input.title !== undefined ? "title" : null,
    input.description !== undefined ? "description" : null,
    input.priority !== undefined ? "priority" : null,
    input.dueAt !== undefined ? "dueAt" : null,
    input.scheduledStartAt !== undefined ? "scheduledStartAt" : null,
    input.scheduledEndAt !== undefined ? "scheduledEndAt" : null,
  ].filter((field): field is string => field !== null);

  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.updated",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      changed_fields: changedFields,
    },
    dedupeKey: `task.updated:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

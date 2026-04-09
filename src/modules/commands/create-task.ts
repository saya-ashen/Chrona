import { OwnerType, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function createTask(input: {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: Date | null;
}) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("title is required");
  }

  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title,
      description: input.description?.trim() || null,
      priority: input.priority ? TaskPriority[input.priority] : TaskPriority.Medium,
      status: TaskStatus.Ready,
      ownerType: OwnerType.human,
      dueAt: input.dueAt ?? null,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.created",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      title: task.title,
      priority: task.priority,
      status: task.status,
    },
    dedupeKey: `task.created:${task.id}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

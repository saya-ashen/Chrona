import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function clearSchedule(input: { taskId: string }) {
  const existingTask = await db.task.findUniqueOrThrow({ where: { id: input.taskId } });

  const task = await db.task.update({
    where: { id: input.taskId },
    data: {
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleStatus: "Unscheduled",
      scheduleSource: null,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.unscheduled",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      previous_due_at: existingTask.dueAt?.toISOString() ?? null,
      previous_scheduled_start_at: existingTask.scheduledStartAt?.toISOString() ?? null,
      previous_scheduled_end_at: existingTask.scheduledEndAt?.toISOString() ?? null,
    },
    dedupeKey: `task.unscheduled:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

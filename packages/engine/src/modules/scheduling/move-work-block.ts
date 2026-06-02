import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { validateScheduleWindow } from "@chrona/domain";

export async function moveWorkBlock(input: {
  workBlockId: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
}) {
  validateScheduleWindow({
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
  });

  const block = await db.workBlock.findUniqueOrThrow({
    where: { id: input.workBlockId },
    select: {
      id: true,
      workspaceId: true,
      taskId: true,
      status: true,
      importedCalendarEvent: { select: { id: true } },
    },
  });

  if (block.status === "Active") {
    throw new Error("Cannot reschedule while a work block is active");
  }
  if (block.status === "Completed" || block.status === "Cancelled") {
    throw new Error("Cannot reschedule a completed or cancelled work block");
  }
  if (block.importedCalendarEvent) {
    throw new Error(
      "External calendar occurrence time is managed by the calendar source",
    );
  }

  await db.workBlock.update({
    where: { id: block.id },
    data: {
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      trigger: "manual",
    },
  });

  await appendCanonicalEvent({
    eventType: "task.schedule_changed",
    workspaceId: block.workspaceId,
    taskId: block.taskId,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      work_block_id: block.id,
      scheduled_start_at: input.scheduledStartAt.toISOString(),
      scheduled_end_at: input.scheduledEndAt.toISOString(),
      schedule_source: "manual",
    },
    dedupeKey: `work_block.schedule_changed:${block.id}:${input.scheduledStartAt.toISOString()}`,
  });

  await rebuildTaskProjection(block.taskId);

  return { workBlockId: block.id, taskId: block.taskId, workspaceId: block.workspaceId };
}

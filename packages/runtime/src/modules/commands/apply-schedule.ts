import type { ScheduleSource } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { enqueueTaskPlanGeneration } from "@/modules/commands/queue-task-plan-generation";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { validateScheduleWindow } from "@chrona/domain";
import { getAcceptedTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

export async function applySchedule(input: {
  taskId: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  scheduleSource: ScheduleSource;
  title?: string;
}) {
  validateScheduleWindow(input);

  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    select: { id: true, workspaceId: true, title: true, updatedAt: true },
  });

  await db.task.update({
    where: { id: input.taskId },
    data: {
      dueAt: input.dueAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      scheduleStatus: "Scheduled",
      scheduleSource: input.scheduleSource,
    },
  });

  if (input.scheduledStartAt && input.scheduledEndAt) {
    const acceptedPlan = await getAcceptedTaskPlanGraph(input.taskId);
    const planId = acceptedPlan?.id ?? null;

    const existingBlock = await db.workBlock.findFirst({
      where: { taskId: input.taskId, status: "Scheduled" },
      orderBy: { createdAt: "desc" },
    });

    if (existingBlock) {
      await db.workBlock.update({
        where: { id: existingBlock.id },
        data: {
          planId,
          title: input.title ?? task.title,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
        },
      });
    } else {
      await db.workBlock.create({
        data: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          planId,
          title: input.title ?? task.title,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          trigger: input.scheduleSource === "ai" ? "scheduled" : "manual",
        },
      });
    }
  }

  await appendCanonicalEvent({
    eventType: "task.schedule_changed",
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      due_at: input.dueAt?.toISOString() ?? null,
      scheduled_start_at: input.scheduledStartAt?.toISOString() ?? null,
      scheduled_end_at: input.scheduledEndAt?.toISOString() ?? null,
      schedule_source: input.scheduleSource,
    },
    dedupeKey: `task.schedule_changed:${task.id}:${task.updatedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  enqueueTaskPlanGeneration({ taskId: task.id, reason: "task_updated", forceRefresh: true });

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

import type { ScheduleSource } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { validateScheduleWindow } from "@chrona/domain";
import { getAcceptedCompiledPlanForTask } from "@/modules/plan-execution/persistence/execution-scope";
import { ensureWorkBlockTaskSession } from "@/modules/execution-runtime";

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
    select: { id: true, workspaceId: true, title: true, executionRuntime: true, updatedAt: true },
  });
  const isExternallyManaged =
    (await db.importedCalendarEvent.count({ where: { taskId: input.taskId } })) > 0;

  await db.task.update({
    where: { id: input.taskId },
    data: {
      dueAt: input.dueAt,
    },
  });

  if (isExternallyManaged) {
    // External calendar tasks own their scheduled window and their
    // per-occurrence work blocks through calendar sync. A task-level schedule
    // apply (manual or AI) must NOT create or move them — it only persists the
    // editable Chrona fields (dueAt above). Skipping the window path also
    // avoids spurious "managed by the calendar source" drift caused by the
    // UI's minute-precision datetime round-trips, and leaves the projection to
    // reflect the authoritative per-occurrence work blocks.
    await rebuildTaskProjection(task.id);
    return {
      taskId: task.id,
      workspaceId: task.workspaceId,
    };
  }

  if (input.scheduledStartAt && input.scheduledEndAt) {
    const acceptedPlan = await getAcceptedCompiledPlanForTask(input.taskId);
    const planId = acceptedPlan?.compiledPlan.editablePlanId ?? null;

    const existingBlock = await db.workBlock.findFirst({
      where: { taskId: input.taskId, status: "Scheduled" },
      orderBy: { createdAt: "desc" },
    });

    if (!existingBlock) {
      const activeBlock = await db.workBlock.findFirst({
        where: { taskId: input.taskId, status: "Active" },
        orderBy: { createdAt: "desc" },
      });
      if (activeBlock) {
        throw new Error("Cannot reschedule while a work block is active");
      }
    }

    if (existingBlock) {
      const workBlock = await db.workBlock.update({
        where: { id: existingBlock.id },
        data: {
          planId,
          title: input.title ?? task.title,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          trigger: input.scheduleSource === "ai" ? "scheduled" : "manual",
        },
        select: { id: true, sessionId: true },
      });
      await ensureWorkBlockTaskSession({
        taskId: task.id,
        taskTitle: task.title,
        runtimeName: task.executionRuntime,
        workBlockId: workBlock.id,
        sessionId: workBlock.sessionId,
        label: `${task.title} · Work block session`,
      });
    } else {
      const workBlock = await db.workBlock.create({
        data: {
          workspaceId: task.workspaceId,
          taskId: task.id,
          planId,
          title: input.title ?? task.title,
          scheduledStartAt: input.scheduledStartAt,
          scheduledEndAt: input.scheduledEndAt,
          trigger: input.scheduleSource === "ai" ? "scheduled" : "manual",
        },
        select: { id: true },
      });
      await ensureWorkBlockTaskSession({
        taskId: task.id,
        taskTitle: task.title,
        runtimeName: task.executionRuntime,
        workBlockId: workBlock.id,
        label: `${task.title} · Work block session`,
      });
    }
  }

  await appendCanonicalEvent({
    eventType: "task.schedule_changed",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: null,
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

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

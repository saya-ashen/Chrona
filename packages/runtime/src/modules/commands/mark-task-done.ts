import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

export async function markTaskDone(input: { taskId: string }) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: input.taskId },
    include: {
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const latestRun = task.runs[0] ?? null;

  if (!latestRun || latestRun.status !== "Completed") {
    throw new Error("Only tasks with a completed run can be marked done.");
  }

  const completedAt = latestRun.endedAt ?? new Date();

  await db.task.update({
    where: { id: task.id },
    data: {
      status: TaskStatus.Done,
      completedAt,
      blockReason: Prisma.DbNull,
    },
  });

  await appendCanonicalEvent({
    eventType: "task.done",
    workspaceId: task.workspaceId,
    taskId: task.id,
    runId: latestRun.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      previous_status: task.status,
      next_status: TaskStatus.Done,
      completed_at: completedAt.toISOString(),
    },
    dedupeKey: `task.done:${task.id}:${completedAt.toISOString()}`,
  });

  await rebuildTaskProjection(task.id);

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
  };
}

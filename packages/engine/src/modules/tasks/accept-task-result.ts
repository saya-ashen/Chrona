import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events";
import { publishTaskWorkspaceUpdatedEvent } from "@/modules/projections/task-projection-events";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export async function acceptTaskResult(input: { taskId: string }) {
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
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      "Only completed runs can be accepted.",
    );
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
    eventType: "task.result_accepted",
    workspaceId: task.workspaceId,
    taskId: task.id,
    workBlockId: null,
    runId: latestRun.id,
    actorType: "user",
    actorId: "server-action",
    source: "ui",
    payload: {
      accepted_run_id: latestRun.id,
      accepted_at: new Date().toISOString(),
    },
    dedupeKey: `task.result_accepted:${task.id}:${latestRun.id}`,
  });

  await rebuildTaskProjection(task.id);

  publishTaskWorkspaceUpdatedEvent({
    taskId: task.id,
    workspaceId: task.workspaceId,
    reason: "task.result_accepted",
  });

  return {
    taskId: task.id,
    workspaceId: task.workspaceId,
    runId: latestRun.id,
  };
}

import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { SYNC_STALE_MS } from "@/modules/runtime-sync/freshness";
import { deriveScheduleState } from "@/modules/tasks/derive-schedule-state";
import { deriveTaskState } from "@/modules/tasks/derive-task-state";

export async function rebuildTaskProjection(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      runs: { orderBy: { updatedAt: "desc" } },
      approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
      artifacts: { orderBy: { createdAt: "desc" }, take: 1 },
      scheduleProposals: { where: { status: "Pending" } },
    },
  });

  const syncStale = task.runs.some(
    (run) => run.lastSyncedAt && Date.now() - run.lastSyncedAt.getTime() > SYNC_STALE_MS,
  );

  const derived = deriveTaskState({
    task: { status: task.status, latestRunId: task.latestRunId },
    runs: task.runs,
    approvals: task.approvals,
    sync: { stale: syncStale },
  });

  const latestRun = task.runs[0] ?? null;
  const schedule = deriveScheduleState({
    task: {
      dueAt: task.dueAt,
      scheduledStartAt: task.scheduledStartAt,
      scheduledEndAt: task.scheduledEndAt,
      scheduleSource: task.scheduleSource,
    },
    latestRun: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt,
          endedAt: latestRun.endedAt,
        }
      : null,
    now: new Date(),
  });

  await db.task.update({
    where: { id: task.id },
    data: {
      status: derived.persistedStatus as never,
      scheduleStatus: schedule.scheduleStatus as never,
      blockReason: derived.blockReason
        ? (derived.blockReason as Prisma.InputJsonValue)
        : Prisma.DbNull,
    },
  });

  return db.taskProjection.upsert({
    where: { taskId: task.id },
    update: {
      workspaceId: task.workspaceId,
      persistedStatus: derived.persistedStatus,
      displayState: derived.displayState,
      blockType: derived.blockReason?.blockType ?? null,
      blockScope: derived.blockReason?.scope ?? null,
      blockSince: derived.blockSince,
      actionRequired: derived.blockReason?.actionRequired ?? null,
      latestRunStatus: latestRun?.status ?? null,
      approvalPendingCount: task.approvals.length,
      dueAt: task.dueAt,
      scheduledStartAt: task.scheduledStartAt,
      scheduledEndAt: task.scheduledEndAt,
      scheduleStatus: schedule.scheduleStatus,
      scheduleSource: task.scheduleSource,
      scheduleProposalCount: task.scheduleProposals.length,
      latestArtifactTitle: task.artifacts[0]?.title ?? null,
      lastActivityAt: latestRun?.updatedAt ?? task.updatedAt,
    },
    create: {
      taskId: task.id,
      workspaceId: task.workspaceId,
      persistedStatus: derived.persistedStatus,
      displayState: derived.displayState,
      blockType: derived.blockReason?.blockType ?? null,
      blockScope: derived.blockReason?.scope ?? null,
      blockSince: derived.blockSince,
      actionRequired: derived.blockReason?.actionRequired ?? null,
      latestRunStatus: latestRun?.status ?? null,
      approvalPendingCount: task.approvals.length,
      dueAt: task.dueAt,
      scheduledStartAt: task.scheduledStartAt,
      scheduledEndAt: task.scheduledEndAt,
      scheduleStatus: schedule.scheduleStatus,
      scheduleSource: task.scheduleSource,
      scheduleProposalCount: task.scheduleProposals.length,
      latestArtifactTitle: task.artifacts[0]?.title ?? null,
      lastActivityAt: latestRun?.updatedAt ?? task.updatedAt,
    },
  });
}

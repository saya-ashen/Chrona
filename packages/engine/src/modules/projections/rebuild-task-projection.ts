import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { SYNC_STALE_MS } from "@/modules/runtime-sync/freshness";
import { deriveScheduleState, deriveTaskState } from "@chrona/domain";

export async function rebuildTaskProjection(taskId: string) {
  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      runs: { orderBy: { updatedAt: "desc" } },
      approvals: { where: { status: "Pending" }, orderBy: { requestedAt: "desc" } },
      artifacts: { orderBy: { createdAt: "desc" }, take: 1 },
      scheduleProposals: { where: { status: "Pending" } },
      executionSessions: {
        where: { status: { in: ["Active", "Paused"] } },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
      workBlocks: {
        where: { status: { in: ["Scheduled", "Active"] } },
        orderBy: { scheduledStartAt: "asc" },
        take: 1,
      },
    },
  });

  const syncStale = task.runs.some(
    (run) => run.lastSyncedAt && Date.now() - run.lastSyncedAt.getTime() > SYNC_STALE_MS,
  );

  const activeSession = task.executionSessions[0] ?? null;

  const derived = deriveTaskState({
    task: { status: task.status, latestRunId: task.latestRunId },
    runs: task.runs,
    approvals: task.approvals,
    sync: { stale: syncStale },
    executionSession: activeSession
      ? {
          status: activeSession.status,
          currentNodeId: activeSession.currentNodeId,
          pauseReason: activeSession.pauseReason,
        }
      : null,
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

  // NOTE: Prisma 7 + WASM query compiler can crash when Prisma.DbNull is
  // passed in an update alongside other nullable fields (e.g. after a
  // clearSchedule call). Avoid it by skipping blockReason when the current
  // stored value is already null and there is no new value to set.
  const shouldClearBlockReason = !derived.blockReason && task.blockReason !== null;
  const updateData: Record<string, unknown> = {
    status: derived.persistedStatus,
    scheduleStatus: schedule.scheduleStatus,
  };
  if (derived.blockReason) {
    updateData.blockReason = derived.blockReason as Prisma.InputJsonValue;
  } else if (shouldClearBlockReason) {
    // Only use DbNull when we genuinely need to clear a previously-set value
    updateData.blockReason = Prisma.DbNull;
  }

  await db.task.update({
    where: { id: task.id },
    data: updateData as never,
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

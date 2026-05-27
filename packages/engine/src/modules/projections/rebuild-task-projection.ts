import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { SYNC_STALE_MS } from "../../constants";
import { deriveScheduleState, deriveTaskState } from "@chrona/domain";
import { appendTaskWorkspaceEvent } from "./task-projection-events";

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
      events: { orderBy: { ingestSequence: "desc" }, take: 1 },
      workBlocks: {
        where: { status: { in: ["Scheduled", "Active", "Completed"] } },
        orderBy: [
          { scheduledStartAt: "asc" },
          { updatedAt: "desc" },
        ],
        take: 1,
      },
    },
  });

  const syncStale = task.runs.some(
    (run) => run.lastSyncedAt && Date.now() - run.lastSyncedAt.getTime() > SYNC_STALE_MS,
  );

  const activeSession = task.executionSessions[0] ?? null;
  const currentWorkBlock = task.workBlocks[0] ?? null;
  const latestEvent = task.events[0] ?? null;
  const currentNode = activeSession?.currentNodeId && activeSession.planId
    ? await db.taskPlanRun.findUnique({
        where: {
          taskId_planId: {
            taskId: task.id,
            planId: activeSession.planId,
          },
        },
        select: { planRun: true },
      })
    : null;
  const currentNodeTitle = currentNodeTitleFromPlanRun(
    currentNode?.planRun,
    activeSession?.currentNodeId,
  );

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
    },
    workBlock: currentWorkBlock
      ? {
          status: currentWorkBlock.status,
          scheduledStartAt: currentWorkBlock.scheduledStartAt,
          scheduledEndAt: currentWorkBlock.scheduledEndAt,
        }
      : null,
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
    latestEventId: latestEvent?.id ?? task.latestEventId ?? null,
    latestRawEventId: latestEvent?.rawEventId ?? task.latestRawEventId ?? null,
    blockedByEventId: derived.blockReason ? task.blockedByEventId : null,
    blockedByRawEventId: derived.blockReason ? task.blockedByRawEventId : null,
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

  const projection = await db.taskProjection.upsert({
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
      scheduledStartAt: currentWorkBlock?.scheduledStartAt ?? null,
      scheduledEndAt: currentWorkBlock?.scheduledEndAt ?? null,
      scheduleStatus: schedule.scheduleStatus,
      scheduleSource:
        currentWorkBlock?.trigger === "scheduled"
          ? "ai"
          : currentWorkBlock?.trigger === "manual"
            ? "human"
            : null,
      scheduleProposalCount: task.scheduleProposals.length,
      latestArtifactTitle: task.artifacts[0]?.title ?? null,
      lastActivityAt: latestRun?.updatedAt ?? task.updatedAt,
      latestEventId: latestEvent?.id ?? task.latestEventId ?? null,
      latestRawEventId: latestEvent?.rawEventId ?? task.latestRawEventId ?? null,
      blockedByEventId: derived.blockReason ? task.blockedByEventId : null,
      blockedByRawEventId: derived.blockReason ? task.blockedByRawEventId : null,
      currentNodeId: activeSession?.currentNodeId ?? null,
      currentNodeTitle,
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
      scheduledStartAt: currentWorkBlock?.scheduledStartAt ?? null,
      scheduledEndAt: currentWorkBlock?.scheduledEndAt ?? null,
      scheduleStatus: schedule.scheduleStatus,
      scheduleSource:
        currentWorkBlock?.trigger === "scheduled"
          ? "ai"
          : currentWorkBlock?.trigger === "manual"
            ? "human"
            : null,
      scheduleProposalCount: task.scheduleProposals.length,
      latestArtifactTitle: task.artifacts[0]?.title ?? null,
      lastActivityAt: latestRun?.updatedAt ?? task.updatedAt,
      latestEventId: latestEvent?.id ?? task.latestEventId ?? null,
      latestRawEventId: latestEvent?.rawEventId ?? task.latestRawEventId ?? null,
      blockedByEventId: derived.blockReason ? task.blockedByEventId : null,
      blockedByRawEventId: derived.blockReason ? task.blockedByRawEventId : null,
      currentNodeId: activeSession?.currentNodeId ?? null,
      currentNodeTitle,
    },
  });

  appendTaskWorkspaceEvent({
    type: "task_projection_updated",
    taskId: projection.taskId,
    workspaceId: projection.workspaceId,
    persistedStatus: projection.persistedStatus,
    updatedAt: new Date().toISOString(),
  });

  return projection;
}

function currentNodeTitleFromPlanRun(planRun: unknown, currentNodeId?: string | null) {
  if (!currentNodeId || !planRun || typeof planRun !== "object") return null;
  const mutableGraph = (planRun as { mutableGraph?: { graph?: { nodes?: unknown[] } } }).mutableGraph;
  const nodes = mutableGraph?.graph?.nodes;
  if (!Array.isArray(nodes)) return null;
  const node = nodes.find(
    (candidate): candidate is { id: string; title?: string } =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === currentNodeId,
  );
  return node?.title ?? null;
}

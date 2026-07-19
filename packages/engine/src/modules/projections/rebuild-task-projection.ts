import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { SYNC_STALE_MS } from "../../constants";
import { deriveScheduleState, deriveTaskState } from "@chrona/domain";
import { resolveScopeWorkBlockId } from "@/modules/plan-execution/persistence/execution-scope";
import { getLatestCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { appendTaskWorkspaceEvent } from "./task-projection-events";


type ProjectionWorkBlock = {
  status: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  trigger: string;
};

function pickProjectionWorkBlock(workBlocks: ProjectionWorkBlock[], now: Date) {
  const active = workBlocks.find((block) => block.status === "Active");
  if (active) return active;

  const nextScheduled = workBlocks.find(
    (block) => block.status === "Scheduled" && block.scheduledStartAt.getTime() >= now.getTime(),
  );
  if (nextScheduled) return nextScheduled;

  const overdueScheduled = workBlocks.find((block) => block.status === "Scheduled");
  if (overdueScheduled) return overdueScheduled;

  return workBlocks.find((block) => block.status === "Completed") ?? null;
}
export async function rebuildTaskProjection(taskId: string) {
  // The canonical occurrence this projection is about. Recurring tasks share a
  // single Task row across many work-block occurrences; runs/sessions/approvals
  // are scoped to this work block so a failed (or cancelled) occurrence never
  // bleeds its state onto a sibling occurrence.
  //
  // The occurrence is whichever one most recently executed (its ExecutionSession
  // in any state — Active/Paused/Completed/Abandoned — is the authoritative
  // record of what ran). Before any run exists we fall back to the plan scope so
  // a freshly-generated/accepted plan still projects against its work block.
  const latestSession = await db.executionSession.findFirst({
    where: { taskId },
    orderBy: [{ updatedAt: "desc" }, { startedAt: "desc" }],
    select: { workBlockId: true },
  });
  const scopeWorkBlockId = latestSession
    ? latestSession.workBlockId
    : await resolveScopeWorkBlockId(taskId);

  const task = await db.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      runs: { where: { workBlockId: scopeWorkBlockId }, orderBy: { updatedAt: "desc" } },
      approvals: {
        where: { status: "Pending", run: { workBlockId: scopeWorkBlockId } },
        orderBy: { requestedAt: "desc" },
      },
      taskPlanProviderApprovals: {
        where: { status: "pending", workBlockId: scopeWorkBlockId },
        orderBy: { requestedAt: "desc" },
      },
      artifacts: { orderBy: { createdAt: "desc" }, take: 1 },
      scheduleProposals: { where: { status: "Pending" } },
      executionSessions: {
        where: { workBlockId: scopeWorkBlockId },
        orderBy: [{ updatedAt: "desc" }, { startedAt: "desc" }],
        take: 1,
      },
      events: { orderBy: { ingestSequence: "desc" }, take: 1 },
      workBlocks: {
        where: { status: { in: ["Scheduled", "Active", "Completed"] } },
        orderBy: [
          { status: "asc" },
          { scheduledStartAt: "asc" },
          { updatedAt: "desc" },
        ],
        take: 50,
      },
    },
  });

  const latestRun = task.runs.find((run) => run.id === task.latestRunId) ?? task.runs[0] ?? null;
  const syncStale = Boolean(
    latestRun?.lastSyncedAt && Date.now() - latestRun.lastSyncedAt.getTime() > SYNC_STALE_MS,
  );

  const now = new Date();
  const session = task.executionSessions[0] ?? null;
  const currentWorkBlock = pickProjectionWorkBlock(task.workBlocks, now);
  const latestEvent = task.events[0] ?? null;
  const currentNode = session?.currentNodeId && session.planId
    ? await db.taskPlanRun.findFirst({
        where: {
          taskId: task.id,
          planId: session.planId,
          workBlockId: session.workBlockId ?? null,
        },
        select: { planRun: true },
      })
    : null;
  const currentNodeTitle = currentNodeTitleFromPlanRun(
    currentNode?.planRun,
    session?.currentNodeId,
  );

  // Latest compiled plan for this work-block scope. Scoped to the same
  // work block as runs/sessions so a fresh draft on a sibling occurrence
  // cannot mask a failed-run block on the canonical one. The draft-plan
  // recover branch in deriveTaskState reads this to clear stale Blocked
  // when the user regenerates a plan to retry.
  const latestPlan = await getLatestCompiledPlan(taskId, scopeWorkBlockId);
  const pendingApprovals = [
    ...task.approvals,
    ...task.taskPlanProviderApprovals.map((approval) => ({
      status: "Pending",
      requestedAt: approval.requestedAt,
    })),
  ];

  const derived = deriveTaskState({
    task: { status: task.status, latestRunId: task.latestRunId },
    runs: task.runs,
    approvals: pendingApprovals,
    sync: { stale: syncStale },
    executionSession: session
      ? {
          status: session.status,
          currentNodeId: session.currentNodeId,
          pauseReason: session.pauseReason,
        }
      : null,
    latestPlan: latestPlan
      ? {
          status: latestPlan.status,
          updatedAt: new Date(latestPlan.updatedAt),
        }
      : null,
  });

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
    now,
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
      blockDetail: derived.blockReason?.detail ?? null,
      blockNodeId: derived.blockReason?.nodeId ?? null,
      latestRunStatus: latestRun?.status ?? null,
      approvalPendingCount: pendingApprovals.length,
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
      currentNodeId: session?.currentNodeId ?? null,
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
      blockDetail: derived.blockReason?.detail ?? null,
      blockNodeId: derived.blockReason?.nodeId ?? null,
      latestRunStatus: latestRun?.status ?? null,
      approvalPendingCount: pendingApprovals.length,
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
      currentNodeId: session?.currentNodeId ?? null,
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

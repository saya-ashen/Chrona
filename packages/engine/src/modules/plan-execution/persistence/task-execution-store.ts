import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { updateTaskSessionStateFromRun } from "@/modules/execution-runtime";

const ACTIVE_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
] as const;


export async function syncTaskRunState(input: {
  taskId: string;
  taskSessionId?: string | null;
  runId: string;
  runStatus: RunStatus;
  runtimeRunRef?: string | null;
  setAsLatest?: boolean;
  rebuildProjection?: boolean;
}) {
  if (input.setAsLatest) {
    await db.task.update({
      where: { id: input.taskId },
      data: { latestRunId: input.runId },
    });
  }
  await updateTaskSessionStateFromRun({
    taskSessionId: input.taskSessionId,
    runId: input.runId,
    runStatus: input.runStatus,
    runtimeRunRef: input.runtimeRunRef,
  });
  if (input.rebuildProjection !== false) {
    await rebuildTaskProjection(input.taskId);
  }
}
export async function markExecutionNodeActive(input: {
  taskId: string;
  sessionId?: string | null;
  currentNodeId: string | null;
  completedNodeIds?: string[];
}) {
  const now = new Date();
  const sessionUpdate = input.sessionId
    ? await db.executionSession.updateMany({
        where: {
          id: input.sessionId,
          status: { notIn: ["Completed", "Abandoned"] },
        },
        data: {
          status: "Active",
          currentNodeId: input.currentNodeId,
          pauseReason: null,
          completedNodeIds: input.completedNodeIds
            ? JSON.stringify(input.completedNodeIds)
            : undefined,
          pausedAt: null,
          completedAt: null,
          updatedAt: now,
        },
      })
    : { count: 0 };
  // The session transition to Active is the authoritative execution fact.
  // rebuildTaskProjection is the single authority that derives Running and
  // clears the block from it — we never write Task.status/blockReason here.
  if (sessionUpdate.count > 0) {
    await rebuildTaskProjection(input.taskId);
  }
}

export async function completeActiveRunsForTask(taskId: string) {
  const now = new Date();
  await db.run.updateMany({
    where: {
      taskId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: {
      status: RunStatus.Completed,
      endedAt: now,
      errorSummary: null,
      retryable: false,
      resumeSupported: false,
      pendingInputPrompt: null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });
}

export async function cancelActiveRunsForTask(taskId: string, reason?: string | null) {
  const now = new Date();
  await db.run.updateMany({
    where: {
      taskId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: {
      status: RunStatus.Cancelled,
      endedAt: now,
      errorSummary: reason ?? null,
      retryable: false,
      resumeSupported: false,
      pendingInputPrompt: null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });
}

import { db } from "@/lib/db";
import { taskPlanExecution } from "@/modules/plan-execution/facade/task-plan-execution.facade";
import { recordOrchestratorEvent } from "./scheduler-events";

type RecoveryTaskRef = { workspaceId: string } | null;

type RestartRecoveryWorkerDeps = {
  recordEvent?: typeof recordOrchestratorEvent;
  reconcileStaleRuntimeRuns?: typeof taskPlanExecution.reconcileStaleRuntimeRuns;
};

export async function runRestartRecoveryWorker(input: {
  now?: Date;
  deps?: RestartRecoveryWorkerDeps;
} = {}) {
  const now = input.now ?? new Date();
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  const reconcileStaleRuntimeRuns = input.deps?.reconcileStaleRuntimeRuns ??
    taskPlanExecution.reconcileStaleRuntimeRuns.bind(taskPlanExecution);
  const expiredLeases = await db.schedulerLease.findMany({ where: { expiresAt: { lte: now } } });
  await db.schedulerLease.deleteMany({ where: { expiresAt: { lte: now } } });

  const activeSessions = await db.executionSession.findMany({
    where: {
      status: "Active",
      task: {
        taskPlanRuns: {
          some: { executionOwnerId: { not: null } },
        },
      },
    },
    include: { task: { select: { workspaceId: true } } },
  });
  for (const session of activeSessions) {
    const task = session.task as RecoveryTaskRef;
    if (task === null) {
      console.warn("[restart-recovery-worker] active session missing task", {
        sessionId: session.id,
        taskId: session.taskId,
      });
      continue;
    }
    await recordEvent({
      workspaceId: task.workspaceId,
      taskId: session.taskId,
      eventType: "scheduler.repair",
      reason: "restart_active_session_scan",
      payload: { sessionId: session.id },
    });
  }

  const degradedRuns = await db.run.findMany({
    where: { syncStatus: "degraded", retryable: true },
    include: { task: { select: { workspaceId: true } } },
  });
  for (const run of degradedRuns) {
    const task = run.task as RecoveryTaskRef;
    if (task === null) {
      console.warn("[restart-recovery-worker] degraded run missing task", {
        runId: run.id,
        taskId: run.taskId,
      });
      continue;
    }
    await recordEvent({
      workspaceId: task.workspaceId,
      taskId: run.taskId,
      eventType: "scheduler.repair",
      reason: "restart_degraded_run_scan",
      payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
    });
  }

  const runtimeReconciliation = await reconcileStaleRuntimeRuns({ limit: 25 });

  return {
    expiredLeaseCount: expiredLeases.length,
    activeSessionCount: activeSessions.length,
    degradedRunCount: degradedRuns.length,
    runtimeReconciliation,
  };
}

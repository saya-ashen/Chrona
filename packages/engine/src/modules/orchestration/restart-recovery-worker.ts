import { db } from "@/lib/db";
import { recordOrchestratorEvent } from "./scheduler-events";

type RestartRecoveryWorkerDeps = {
  recordEvent?: typeof recordOrchestratorEvent;
};

export async function runRestartRecoveryWorker(input: {
  now?: Date;
  deps?: RestartRecoveryWorkerDeps;
} = {}) {
  const now = input.now ?? new Date();
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  const expiredLeases = await db.schedulerLease.findMany({ where: { expiresAt: { lte: now } } });
  await db.schedulerLease.deleteMany({ where: { expiresAt: { lte: now } } });

  const activeSessions = await db.executionSession.findMany({
    where: { status: "Active" },
    include: { task: { select: { workspaceId: true } } },
  });
  for (const session of activeSessions) {
    await recordEvent({
      workspaceId: session.task.workspaceId,
      taskId: session.taskId,
      eventType: "scheduler.repair",
      reason: "restart_active_session_scan",
      payload: { sessionId: session.id, planId: session.planId },
    });
  }

  const degradedRuns = await db.run.findMany({
    where: { syncStatus: "degraded", retryable: true },
    include: { task: { select: { workspaceId: true } } },
  });
  for (const run of degradedRuns) {
    await recordEvent({
      workspaceId: run.task.workspaceId,
      taskId: run.taskId,
      eventType: "scheduler.repair",
      reason: "restart_degraded_run_scan",
      payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
    });
  }

  return {
    expiredLeaseCount: expiredLeases.length,
    activeSessionCount: activeSessions.length,
    degradedRunCount: degradedRuns.length,
  };
}

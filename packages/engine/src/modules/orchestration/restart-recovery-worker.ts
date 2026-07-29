import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { taskPlanExecution } from "@/modules/plan-execution/facade/task-plan-execution.facade";
import { setExecutionSessionState } from "@/modules/plan-execution/persistence/execution-session-store";
import { rebuildTaskProjection } from "@/modules/projections";
import { recoverRecordedTerminalActions } from "@/modules/plan-execution/use-cases/recover-recorded-terminal-actions";
import { recordOrchestratorEvent } from "./scheduler-events";
import { createLogger } from "@chrona/logging";

const logger = createLogger("engine.orchestration.restart-recovery");

type RecoveryTaskRef = { workspaceId: string } | null;

// A run is "live" while a provider could still be advancing it. An Active
// ExecutionSession whose task has NO live run is a crash leftover: the
// restart-recovery worker and the graph-advancement worker run serially in the
// same orchestrator tick, so a healthy in-flight session always has a live run
// (or sits in Paused/WaitingFor*). The negative below is the symmetric twin of
// graph-advancement-worker's `runs: { none: { status: { in: [...] } } }`.
const LIVE_RUN_STATUSES: RunStatus[] = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForInput,
  RunStatus.WaitingForApproval,
];

type RestartRecoveryWorkerDeps = {
  recordEvent?: typeof recordOrchestratorEvent;
  recoverRecordedTerminalActions?: typeof recoverRecordedTerminalActions;
  reconcileStaleRuntimeRuns?: typeof taskPlanExecution.reconcileStaleRuntimeRuns;
  setExecutionSessionState?: typeof setExecutionSessionState;
  rebuildTaskProjection?: typeof rebuildTaskProjection;
};

type OrphanedSession = {
  id: string;
  taskId: string;
  task: RecoveryTaskRef;
};

type DegradedRun = {
  id: string;
  taskId: string;
  runtimeRunRef: string | null;
  task: RecoveryTaskRef;
};

type RestartRecoveryDependencies = {
  abandonSession: typeof setExecutionSessionState;
  rebuildProjection: typeof rebuildTaskProjection;
  recordEvent: typeof recordOrchestratorEvent;
};

async function abandonOrphanedSession(
  session: OrphanedSession,
  { abandonSession, recordEvent, rebuildProjection }: RestartRecoveryDependencies,
) {
  const task = session.task;
  if (task === null) {
    logger.warn("active_session_missing_task", {
      sessionId: session.id,
      taskId: session.taskId,
    });
    return false;
  }

  await abandonSession({
    sessionId: session.id,
    status: "Abandoned",
    currentNodeId: null,
    currentNodeAttemptId: null,
    pauseReason: "restart_recovery_abandoned",
  });
  await recordEvent({
    workspaceId: task.workspaceId,
    taskId: session.taskId,
    eventType: "scheduler.repair",
    reason: "restart_active_session_abandoned",
    payload: { sessionId: session.id },
  });
  await rebuildProjection(session.taskId);
  return true;
}

function recordDegradedRun(run: DegradedRun, recordEvent: typeof recordOrchestratorEvent) {
  const task = run.task;
  if (task === null) {
    logger.warn("degraded_run_missing_task", {
      runId: run.id,
      taskId: run.taskId,
    });
    return Promise.resolve();
  }

  return recordEvent({
    workspaceId: task.workspaceId,
    taskId: run.taskId,
    eventType: "scheduler.repair",
    reason: "restart_degraded_run_scan",
    payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
  });
}

function resolveRestartRecoveryDependencies(deps: RestartRecoveryWorkerDeps = {}) {
  return {
    recordEvent: deps.recordEvent ?? recordOrchestratorEvent,
    reconcileStaleRuntimeRuns: deps.reconcileStaleRuntimeRuns ??
      taskPlanExecution.reconcileStaleRuntimeRuns.bind(taskPlanExecution),
    abandonSession: deps.setExecutionSessionState ?? setExecutionSessionState,
    rebuildProjection: deps.rebuildTaskProjection ?? rebuildTaskProjection,
    recoverTerminalActions: deps.recoverRecordedTerminalActions ?? recoverRecordedTerminalActions,
  };
}

export async function runRestartRecoveryWorker(input: {
  now?: Date;
  deps?: RestartRecoveryWorkerDeps;
} = {}) {
  const now = input.now ?? new Date();
  const {
    recordEvent,
    reconcileStaleRuntimeRuns,
    abandonSession,
    rebuildProjection,
    recoverTerminalActions,
  } = resolveRestartRecoveryDependencies(input.deps);
  const expiredLeases = await db.schedulerLease.findMany({ where: { expiresAt: { lte: now } } });
  await db.schedulerLease.deleteMany({ where: { expiresAt: { lte: now } } });

  // Crash-leftover Active sessions: status === "Active", claimed by some
  // process (executionOwnerId set), AND the task has no live run. The
  // `runs: { none: { ... } }` clause is what makes this safe — it excludes any
  // session whose task still has a Pending/Running/WaitingFor* run, so a
  // genuinely in-flight session is never abandoned.
  const orphanedSessions = await db.executionSession.findMany({
    where: {
      status: "Active",
      task: {
        runs: { none: { status: { in: LIVE_RUN_STATUSES } } },
        taskPlanRuns: {
          some: { executionOwnerId: { not: null } },
        },
      },
    },
    include: { task: { select: { workspaceId: true } } },
  });
  const abandonedSessions = await Promise.all(
    orphanedSessions.map((session) => abandonOrphanedSession(session, {
      abandonSession,
      recordEvent,
      rebuildProjection,
    })),
  );
  const abandonedSessionCount = abandonedSessions.filter(Boolean).length;

  const degradedRuns = await db.run.findMany({
    where: { syncStatus: "degraded", retryable: true },
    include: { task: { select: { workspaceId: true } } },
  });
  await Promise.all(degradedRuns.map((run) => recordDegradedRun(run, recordEvent)));

  // A terminal control action is durable proof that the provider finished the
  // node. Replay it through the execution kernel before runtime-run lookup so
  // process loss cannot strand an acknowledged result in Running.
  const terminalActionRecovery = await recoverTerminalActions({ limit: 25 });

  const runtimeReconciliation = await reconcileStaleRuntimeRuns({ limit: 25 });

  return {
    expiredLeaseCount: expiredLeases.length,
    activeSessionCount: orphanedSessions.length,
    abandonedSessionCount,
    degradedRunCount: degradedRuns.length,
    runtimeReconciliation,
    terminalActionRecovery,
  };
}

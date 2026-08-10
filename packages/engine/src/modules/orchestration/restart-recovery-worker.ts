import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { taskPlanExecution } from "@/modules/plan-execution/facade/task-plan-execution.facade";
import { setExecutionSessionState } from "@/modules/plan-execution/persistence/execution-session-store";
import { rebuildTaskProjectionInTransaction } from "@/modules/projections/rebuild-task-projection";
import { recoverRecordedTerminalActions } from "@/modules/plan-execution/use-cases/recover-recorded-terminal-actions";
import { recordOrchestratorEvent } from "./scheduler-events";
import { assertSchedulerWorkOwnership, withSchedulerWorkOwnership, type SchedulerWorkContext } from "./scheduler-lease-repository";
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
  rebuildTaskProjection?: typeof rebuildTaskProjectionInTransaction;
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
  rebuildProjection: typeof rebuildTaskProjectionInTransaction;
  recordEvent: typeof recordOrchestratorEvent;
};

async function abandonOrphanedSession(
  session: OrphanedSession,
  { abandonSession, recordEvent, rebuildProjection }: RestartRecoveryDependencies,
  workContext?: SchedulerWorkContext,
) {
  const task = session.task;
  if (task === null) {
    logger.warn("active_session_missing_task", {
      sessionId: session.id,
      taskId: session.taskId,
    });
    return false;
  }

  await withSchedulerWorkOwnership(workContext, async (tx) => {
    await abandonSession({
      sessionId: session.id,
      status: "Abandoned",
      currentNodeId: null,
      currentNodeAttemptId: null,
      pauseReason: "restart_recovery_abandoned",
    }, tx);
    await recordEvent({
      workspaceId: task.workspaceId,
      taskId: session.taskId,
      eventType: "scheduler.repair",
      reason: "restart_active_session_abandoned",
      payload: { sessionId: session.id },
    }, tx);
    await rebuildProjection(session.taskId, tx);
  });
  return true;
}

async function recordDegradedRun(
  run: DegradedRun,
  recordEvent: typeof recordOrchestratorEvent,
  workContext?: SchedulerWorkContext,
) {
  const task = run.task;
  if (task === null) {
    logger.warn("degraded_run_missing_task", {
      runId: run.id,
      taskId: run.taskId,
    });
    return Promise.resolve();
  }

  return withSchedulerWorkOwnership(workContext, (tx) => recordEvent({
    workspaceId: task.workspaceId,
    taskId: run.taskId,
    eventType: "scheduler.repair",
    reason: "restart_degraded_run_scan",
    payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
  }, tx));
}

function resolveRestartRecoveryDependencies(deps: RestartRecoveryWorkerDeps = {}) {
  return {
    recordEvent: deps.recordEvent ?? recordOrchestratorEvent,
    reconcileStaleRuntimeRuns: deps.reconcileStaleRuntimeRuns ??
      taskPlanExecution.reconcileStaleRuntimeRuns.bind(taskPlanExecution),
    abandonSession: deps.setExecutionSessionState ?? setExecutionSessionState,
    rebuildProjection: deps.rebuildTaskProjection ?? rebuildTaskProjectionInTransaction,
    recoverTerminalActions: deps.recoverRecordedTerminalActions ?? recoverRecordedTerminalActions,
  };
}

export async function runRestartRecoveryWorker(input: {
  now?: Date;
  workContext?: SchedulerWorkContext;
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
  await assertSchedulerWorkOwnership(input.workContext);
  const expiredLeases = await db.schedulerLease.findMany({ where: { expiresAt: { lte: now } } });
  await withSchedulerWorkOwnership(input.workContext, (tx) =>
    tx.schedulerLease.deleteMany({ where: { expiresAt: { lte: now } } }),
  );
  await assertSchedulerWorkOwnership(input.workContext);

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
  const abandonedSessions = [];
  for (const session of orphanedSessions) {
    await assertSchedulerWorkOwnership(input.workContext);
    abandonedSessions.push(await abandonOrphanedSession(session, {
      abandonSession,
      recordEvent,
      rebuildProjection,
    }, input.workContext));
  }
  const abandonedSessionCount = abandonedSessions.filter(Boolean).length;

  const degradedRuns = await db.run.findMany({
    where: { syncStatus: "degraded", retryable: true },
    include: { task: { select: { workspaceId: true } } },
  });
  await assertSchedulerWorkOwnership(input.workContext);
  for (const run of degradedRuns) {
    await assertSchedulerWorkOwnership(input.workContext);
    await recordDegradedRun(run, recordEvent, input.workContext);
  }

  // A terminal control action is durable proof that the provider finished the
  // node. Replay it through the execution kernel before runtime-run lookup so
  // process loss cannot strand an acknowledged result in Running.
  await assertSchedulerWorkOwnership(input.workContext);
  const terminalActionRecovery = await recoverTerminalActions({ limit: 25, workContext: input.workContext });
  await assertSchedulerWorkOwnership(input.workContext);
  const runtimeReconciliation = await reconcileStaleRuntimeRuns({ limit: 25, workContext: input.workContext });
  await assertSchedulerWorkOwnership(input.workContext);

  return {
    expiredLeaseCount: expiredLeases.length,
    activeSessionCount: orphanedSessions.length,
    abandonedSessionCount,
    degradedRunCount: degradedRuns.length,
    runtimeReconciliation,
    terminalActionRecovery,
  };
}

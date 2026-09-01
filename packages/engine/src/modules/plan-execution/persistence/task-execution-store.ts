import { Prisma, RunStatus, TaskOccurrenceStatus } from "@/generated/prisma/client";
import { rebuildTaskProjectionInTransaction } from "@/modules/projections/rebuild-task-projection";
import { updateTaskSessionStateFromRunInTransaction } from "@/modules/execution-runtime";
import { terminalizePlanRunScopeInTransaction } from "./plan-run-terminalizer";
import { withPlanExecutionDurability } from "./scheduler-durability";
import type { ChronaToolName } from "@chrona/contracts";

const PLAN_EXECUTION_ALLOWED_TOOL_NAMES = [
  "chrona.execution.read",
  "chrona.goal.results.read",
  "chrona.plan.read",
  "chrona.node.read",
  "chrona.node.complete",
  "chrona.node.condition_select",
  "chrona.node.block",
  "chrona.node.fail",
  "chrona.node.request_input",
  "chrona.node.wait_complete",
] as const satisfies readonly ChronaToolName[];
const PLAN_EXECUTION_ALLOWED_TOOL_NAMES_JSON = JSON.stringify(PLAN_EXECUTION_ALLOWED_TOOL_NAMES);

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
];
const TERMINAL_OCCURRENCE_STATUSES: TaskOccurrenceStatus[] = [
  TaskOccurrenceStatus.Completed,
  TaskOccurrenceStatus.Cancelled,
  TaskOccurrenceStatus.Failed,
];


export async function syncPersistedRunState(input: {
  taskId: string;
  runId: string;
  setAsLatest?: boolean;
  rebuildProjection?: boolean;
}) {
  return withPlanExecutionDurability((tx) => syncPersistedRunStateInTransaction(input, tx));
}

/** Scheduler recovery must supply its existing fenced transaction. */
export async function syncPersistedRunStateInTransaction(
  input: { taskId: string; runId: string; setAsLatest?: boolean; rebuildProjection?: boolean },
  tx: Prisma.TransactionClient,
) {
  const run = await tx.run.findFirst({
    where: { id: input.runId, taskId: input.taskId },
    select: { occurrenceId: true, runtimeRunRef: true, status: true, taskSessionId: true },
  });
  if (!run) return;
  if (input.setAsLatest) {
    await tx.task.updateMany({ where: { id: input.taskId, runs: { some: { id: input.runId } } }, data: { latestRunId: input.runId } });
  }
  await updateTaskSessionStateFromRunInTransaction({
    taskSessionId: run.taskSessionId,
    runId: input.runId,
    runStatus: run.status,
    runtimeRunRef: run.runtimeRunRef,
  }, tx);
  if (run.taskSessionId) {
    await tx.taskSession.update({
      where: { id: run.taskSessionId },
      data: {
        capabilityScope: "plan_execution",
        allowedToolNames: PLAN_EXECUTION_ALLOWED_TOOL_NAMES_JSON,
      },
    });
  }
  if (!ACTIVE_RUN_STATUSES.includes(run.status)) {
    await tx.runToken.updateMany({ where: { runId: input.runId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  if (run.occurrenceId) {
    await syncOccurrenceStateFromRunInTransaction({ occurrenceId: run.occurrenceId, runStatus: run.status }, tx);
  }
  if (input.rebuildProjection !== false) {
    await rebuildTaskProjectionInTransaction(input.taskId, tx);
  }
}

async function syncOccurrenceStateFromRunInTransaction(
  input: { occurrenceId: string; runStatus: RunStatus },
  tx: Prisma.TransactionClient,
) {
  const terminal = input.runStatus === RunStatus.Completed || input.runStatus === RunStatus.Cancelled || input.runStatus === RunStatus.Failed;
  const status: TaskOccurrenceStatus = input.runStatus === RunStatus.Completed ? TaskOccurrenceStatus.Completed : input.runStatus === RunStatus.Cancelled ? TaskOccurrenceStatus.Cancelled : input.runStatus === RunStatus.Failed ? TaskOccurrenceStatus.Failed : input.runStatus === RunStatus.WaitingForInput ? TaskOccurrenceStatus.WaitingForInput : input.runStatus === RunStatus.WaitingForApproval ? TaskOccurrenceStatus.WaitingForApproval : TaskOccurrenceStatus.Running;
  await tx.taskOccurrence.updateMany({
    where: terminal
      ? { id: input.occurrenceId, status: { notIn: TERMINAL_OCCURRENCE_STATUSES } }
      : { id: input.occurrenceId, status: { notIn: TERMINAL_OCCURRENCE_STATUSES }, completedAt: null },
    data: terminal ? { status, completedAt: new Date() } : { status, startedAt: new Date() },
  });
}

export async function markExecutionNodeActive(input: {
  taskId: string;
  sessionId: string;
  planId: string;
  workBlockId: string | null;
  expectedExecutionEpoch: number;
  currentNodeId: string | null;
  completedNodeIds?: string[];
}): Promise<boolean> {
  return withPlanExecutionDurability(async (tx) => {
    const claimedPlanRun = await tx.taskPlanRun.updateMany({
      where: {
        taskId: input.taskId,
        planId: input.planId,
        workBlockScopeKey: input.workBlockId ?? "",
        executionEpoch: input.expectedExecutionEpoch,
      },
      data: { executionEpoch: input.expectedExecutionEpoch },
    });
    if (claimedPlanRun.count !== 1) return false;

    const now = new Date();
    const sessionUpdate = await tx.executionSession.updateMany({
      where: {
        id: input.sessionId,
        taskId: input.taskId,
        planId: input.planId,
        workBlockId: input.workBlockId,
        status: { in: ["Active", "Paused"] },
      },
      data: {
        status: "Active",
        currentNodeId: input.currentNodeId,
        pauseReason: null,
        completedNodeIds: input.completedNodeIds ? JSON.stringify(input.completedNodeIds) : undefined,
        pausedAt: null,
        completedAt: null,
        updatedAt: now,
      },
    });
    if (sessionUpdate.count !== 1) return false;
    await rebuildTaskProjectionInTransaction(input.taskId, tx);
    return true;
  });
}

export async function ensurePlanExecutionRun(input: {
  taskId: string;
  planRunId: string;
  workBlockId?: string | null;
  occurrenceId?: string | null;
  taskSessionId?: string | null;
  status: RunStatus;
  triggeredBy?: string;
  setAsLatest?: boolean;
}, tx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability(async (client) => {
    const runId = `plan_execution_${input.planRunId}`;
    const existing = await client.run.findUnique({ where: { id: runId } });
    const terminal = input.status === RunStatus.Completed
      || input.status === RunStatus.Cancelled
      || input.status === RunStatus.Failed;
    const run = existing
      ? (ACTIVE_RUN_STATUSES.includes(existing.status) && terminal
        ? await client.run.update({
            where: { id: existing.id },
            data: {
              status: input.status,
              endedAt: new Date(),
              lastSyncedAt: new Date(),
              syncStatus: "healthy",
              retryable: false,
              resumeSupported: false,
              pendingInputPrompt: null,
            },
          })
        : existing)
      : await client.run.create({
          data: {
            id: runId,
            taskId: input.taskId,
            workBlockId: input.workBlockId ?? null,
            occurrenceId: input.occurrenceId ?? null,
            taskSessionId: input.taskSessionId ?? null,
            runtimeName: "chrona-plan",
            runtimeRunRef: `chrona-plan:${input.planRunId}`,
            runtimeConfigSnapshot: {
              canonical: "plan_execution",
              planRunId: input.planRunId,
            },
            status: input.status,
            startedAt: new Date(),
            endedAt: terminal ? new Date() : null,
            triggeredBy: input.triggeredBy ?? "system",
            retryable: false,
            resumeSupported: false,
            syncStatus: "healthy",
          },
        });

    await client.task.updateMany({
      where: input.setAsLatest
        ? { id: input.taskId }
        : { id: input.taskId, latestRunId: null },
      data: { latestRunId: run.id },
    });
    return run;
  }, tx);
}

export async function completeActiveRunsForExecutionScope(input: {
  taskId: string;
  taskSessionId: string;
  occurrenceId?: string | null;
  workBlockId?: string | null;
  planRunId?: string;
}, tx?: Prisma.TransactionClient) {
  return withPlanExecutionDurability(
    (client) => updateActiveRunsForExecutionScope({ ...input, status: RunStatus.Completed }, client),
    tx,
  );
}

export async function cancelActiveRunsForExecutionScope(
  input: {
    taskId: string;
    taskSessionId: string;
    occurrenceId?: string | null;
    workBlockId?: string | null;
    planRunId?: string;
    reason?: string | null;
  },
  tx?: Prisma.TransactionClient,
) {
  return withPlanExecutionDurability(
    (client) => updateActiveRunsForExecutionScope({ ...input, status: RunStatus.Cancelled }, client),
    tx,
  );
}

async function updateActiveRunsForExecutionScope(input: {
  taskId: string;
  taskSessionId: string;
  occurrenceId?: string | null;
  workBlockId?: string | null;
  planRunId?: string;
  status: Extract<RunStatus, "Completed" | "Cancelled">;
  reason?: string | null;
}, tx: Prisma.TransactionClient) {
  const now = new Date();
  await tx.run.updateMany({
    where: {
      taskId: input.taskId,
      taskSessionId: input.taskSessionId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
      ...(input.occurrenceId
        ? { occurrenceId: input.occurrenceId }
        : { workBlockId: input.workBlockId ?? null }),
    },
    data: {
      status: input.status,
      endedAt: now,
      errorSummary: input.status === RunStatus.Cancelled ? input.reason ?? null : null,
      retryable: false,
      resumeSupported: false,
      pendingInputPrompt: null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });
  if (input.planRunId) {
    await terminalizePlanRunScopeInTransaction({
      taskId: input.taskId,
      workBlockId: input.workBlockId ?? null,
      planRunId: input.planRunId,
      occurrenceId: input.occurrenceId ?? null,
      status: input.status,
    }, tx);
  }
  if (input.occurrenceId) {
    await syncOccurrenceStateFromRunInTransaction({
      occurrenceId: input.occurrenceId,
      runStatus: input.status,
    }, tx);
  }
}

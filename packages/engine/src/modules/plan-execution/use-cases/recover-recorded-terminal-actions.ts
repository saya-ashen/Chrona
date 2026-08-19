/* eslint-disable complexity, @typescript-eslint/no-unnecessary-condition -- Recovery defensively validates every persisted terminal candidate identity. */
import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { submitNodeResultActionFromControl } from "@/modules/agent-tools/node-result-action";
import { submitTerminalNodeResult } from "./submit-terminal-node-result";
import { agentControlActionBodySchema } from "@chrona/contracts/api";
import { createLogger } from "@chrona/logging";
import { assertSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";

const logger = createLogger("engine.plan-execution.terminal-action-recovery");

const ACTIVE_RUN_STATUSES: RunStatus[] = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForInput,
  RunStatus.WaitingForApproval,
];

export type RecoverRecordedTerminalActionsResult = {
  checked: number;
  recovered: number;
  skipped: number;
  failed: number;
};

/**
 * Replays terminal control actions that were durably acknowledged before the
 * provider stream could commit the corresponding node result. The execution
 * kernel remains the sole writer of graph/session/task state.
 */
async function findRecoverableTerminalActions(input: {
  taskId?: string;
  limit?: number;
}) {
  return db.taskPlanTerminalAction.findMany({
    where: {
      taskId: input.taskId,
      nodeAttemptId: { not: null },
      nodeAttempt: {
        status: "running",
      },
      run: { status: { in: ACTIVE_RUN_STATUSES } },
    },
    include: {
      run: { select: { id: true, taskSessionId: true, runtimeRunRef: true } },
      nodeAttempt: {
        select: {
          id: true,
          nodeId: true,
          planRun: {
            select: {
              planId: true,
              workBlockId: true,
              occurrenceId: true,
            },
          },
          providerRuns: {
            where: { status: "running" },
            orderBy: { startedAt: "desc" },
            take: 2,
            select: { id: true, runId: true, providerRunRef: true },
          },
        },
      },
    },
    orderBy: { recordedAt: "asc" },
    take: input.limit ?? 25,
  });
}

type RecoverableTerminalAction = Awaited<ReturnType<typeof findRecoverableTerminalActions>>[number];
type TerminalActionRecoveryOutcome = "recovered" | "skipped";

export function terminalRunStatusForAttempt(status: string) {
  if (status === "succeeded") return RunStatus.Completed;
  if (status === "failed") return RunStatus.Failed;
  if (status === "cancelled") return RunStatus.Cancelled;
  return null;
}

async function recoverTerminalAction(
  candidate: RecoverableTerminalAction,
  workContext?: SchedulerWorkContext,
): Promise<TerminalActionRecoveryOutcome> {
  const nodeAttempt = candidate.nodeAttempt;
  if (
    !nodeAttempt
    || candidate.nodeAttemptId !== nodeAttempt.id
  ) {
    return "skipped";
  }

  const executionSession = await db.executionSession.findFirst({
    where: {
      taskId: candidate.taskId,
      planId: nodeAttempt.planRun.planId,
      workBlockId: nodeAttempt.planRun.workBlockId,
      occurrenceId: nodeAttempt.planRun.occurrenceId,
      activeScopeKey: "active",
      status: { in: ["Active", "Paused"] },
    },
    select: { id: true, currentNodeAttemptId: true },
  });
  if (
    !executionSession
    || (executionSession.currentNodeAttemptId && executionSession.currentNodeAttemptId !== nodeAttempt.id)
  ) return "skipped";

  const body = agentControlActionBodySchema.parse({
    kind: candidate.kind,
    payload: candidate.payload,
  });
  const action = submitNodeResultActionFromControl({
    body,
    sessionId: executionSession.id,
  });
  if (!action) {
    return "skipped";
  }

  const [providerRun] = nodeAttempt.providerRuns;
  if (nodeAttempt.providerRuns.length > 1) return "skipped";
  const preProviderFailure = candidate.kind === "fail"
    && !providerRun
    && !candidate.run.runtimeRunRef;
  if (
    !preProviderFailure
    && (
      !providerRun
      || providerRun.runId !== candidate.run.id
      || !candidate.run.runtimeRunRef
    )
  ) return "skipped";
  const { sessionId, ...publicAction } = action;
  await submitTerminalNodeResult({
    taskId: candidate.taskId,
    commandContext: {
      sessionId: sessionId ?? undefined,
      runId: candidate.run.id,
      nodeAttemptId: nodeAttempt.id,
      ...(providerRun ? { providerRunId: providerRun.id } : {}),
      ...(candidate.run.runtimeRunRef ? { runtimeRunRef: candidate.run.runtimeRunRef } : {}),
      idempotencyKey: `terminal-action:${candidate.id}`,
      actor: {
        type: "system",
        service: "restart-recovery",
        reason: "recorded_terminal_action",
      },
      origin: { channel: "internal" },
    },
    action: { ...publicAction, nodeId: nodeAttempt.nodeId },
    workContext,
  });
  const finalizedAttempt = await db.taskPlanNodeAttempt.findUnique({
    where: { id: nodeAttempt.id },
    select: { status: true },
  });
  if (!finalizedAttempt || finalizedAttempt.status === "running") {
    throw new Error("Recorded terminal action did not finalize its exact node attempt");
  }
  await assertSchedulerWorkOwnership(workContext);
  const expectedRunStatus = terminalRunStatusForAttempt(finalizedAttempt.status);
  const finalizedRun = await db.run.findUnique({
    where: { id: candidate.run.id },
    select: { status: true },
  });
  if (!expectedRunStatus || finalizedRun?.status !== expectedRunStatus) {
    throw new Error("Recorded terminal action was accepted without authoritative Run terminalization");
  }
  await assertSchedulerWorkOwnership(workContext);
  return "recovered";
}

function recordRecoveryFailure(candidate: RecoverableTerminalAction, error: unknown) {
  logger.error("terminal_action_recovery.failed", {
    terminalActionId: candidate.id,
    taskId: candidate.taskId,
    runId: candidate.run.id,
    nodeAttemptId: candidate.nodeAttemptId,
    error,
  });
}

/**
 * Replays terminal control actions that were durably acknowledged before the
 * provider stream could commit the corresponding node result. The execution
 * kernel remains the sole writer of graph/session/task state.
 */
export async function recoverRecordedTerminalActions(input: {
  taskId?: string;
  limit?: number;
  workContext?: SchedulerWorkContext;
} = {}): Promise<RecoverRecordedTerminalActionsResult> {
  const candidates = await findRecoverableTerminalActions(input);
  const result: RecoverRecordedTerminalActionsResult = {
    checked: candidates.length,
    recovered: 0,
    skipped: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    await assertSchedulerWorkOwnership(input.workContext);
    try {
      result[await recoverTerminalAction(candidate, input.workContext)] += 1;
      await assertSchedulerWorkOwnership(input.workContext);
    } catch (error) {
      result.failed += 1;
      recordRecoveryFailure(candidate, error);
    }
  }

  return result;
}

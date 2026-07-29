import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { submitNodeResultActionFromControl } from "@/modules/agent-tools/node-result-action";
import { submitTerminalNodeResult } from "./submit-terminal-node-result";
import { syncTaskRunState } from "../persistence/task-execution-store";
import { agentControlActionBodySchema } from "@chrona/contracts/api";
import { createLogger } from "@chrona/logging";

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
        providerRuns: { some: { status: "running" } },
      },
      run: { status: { in: ACTIVE_RUN_STATUSES } },
      task: { latestRunId: { not: null } },
    },
    include: {
      task: { select: { latestRunId: true } },
      run: { select: { id: true, taskSessionId: true, runtimeRunRef: true } },
      nodeAttempt: { select: { id: true, nodeId: true } },
    },
    orderBy: { recordedAt: "asc" },
    take: input.limit ?? 25,
  });
}

type RecoverableTerminalAction = Awaited<ReturnType<typeof findRecoverableTerminalActions>>[number];
type TerminalActionRecoveryOutcome = "recovered" | "skipped";

function terminalRunStatusFor(action: { action: string }) {
  return action.action === "complete_manual_node" ? RunStatus.Completed : RunStatus.Failed;
}

async function recoverTerminalAction(
  candidate: RecoverableTerminalAction,
): Promise<TerminalActionRecoveryOutcome> {
  const nodeAttempt = candidate.nodeAttempt;
  if (
    !nodeAttempt
    || candidate.task.latestRunId !== candidate.run.id
    || candidate.nodeAttemptId !== nodeAttempt.id
  ) {
    return "skipped";
  }

  const body = agentControlActionBodySchema.parse({
    kind: candidate.kind,
    payload: candidate.payload,
  });
  const action = submitNodeResultActionFromControl({
    body,
    sessionId: candidate.taskSessionId ?? candidate.run.taskSessionId ?? undefined,
  });
  if (!action) {
    return "skipped";
  }

  await submitTerminalNodeResult({
    taskId: candidate.taskId,
    commandContext: {
      actor: {
        type: "system",
        service: "restart-recovery",
        reason: "recorded_terminal_action",
      },
      origin: { channel: "internal" },
    },
    action: { ...action, nodeId: nodeAttempt.nodeId },
  });

  const now = new Date();
  const runStatus = terminalRunStatusFor(action);
  await db.run.updateMany({
    where: { id: candidate.run.id, status: { in: ACTIVE_RUN_STATUSES } },
    data: {
      status: runStatus,
      endedAt: now,
      errorSummary: action.action === "fail_current_node" ? action.error : null,
      retryable: false,
      resumeSupported: false,
      pendingInputPrompt: null,
      lastSyncedAt: now,
      syncStatus: "healthy",
      mappingPartial: false,
    },
  });
  await syncTaskRunState({
    taskId: candidate.taskId,
    taskSessionId: candidate.run.taskSessionId,
    runId: candidate.run.id,
    runStatus,
    runtimeRunRef: candidate.run.runtimeRunRef,
  });
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
} = {}): Promise<RecoverRecordedTerminalActionsResult> {
  const candidates = await findRecoverableTerminalActions(input);
  const result: RecoverRecordedTerminalActionsResult = {
    checked: candidates.length,
    recovered: 0,
    skipped: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      result[await recoverTerminalAction(candidate)] += 1;
    } catch (error) {
      result.failed += 1;
      recordRecoveryFailure(candidate, error);
    }
  }

  return result;
}

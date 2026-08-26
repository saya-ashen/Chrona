import type { GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { PlanExecutionResult, PlanExecutionStatus, PlanOutputState, WaitKind } from "@chrona/contracts/ai";
import type { Prisma } from "@/generated/prisma/client";
import { rebuildTaskProjectionInTransaction } from "@/modules/projections/rebuild-task-projection";
import { executionStatusFromGraphOutcome, executionTransition, planRunStatusForExecutionStatus } from "../execution-state-machine";
import { completeActiveRunsForExecutionScope, cancelActiveRunsForExecutionScope } from "../persistence/task-execution-store";
import { setExecutionSessionState, type ExecutionSessionRow } from "../persistence/execution-session-store";
import { completeWorkBlock, releaseWorkBlock } from "../persistence/work-block-store";
import { appendMainSessionEvent } from "../persistence/plan-state-store";
import { terminalizePlanRunScopeInTransaction } from "../persistence/plan-run-terminalizer";
import { buildExecutionResponse } from "../projection/execution-response";
import { currentNodeFromOutcome, latestStartedNodeId } from "../projection/execution-graph-selectors";
import { waitKindFromOutcome } from "../runtime/runtime-outcome";
import type { NativePlanRuntime } from "../persistence/plan-runtime-store";

type FinalizeOutcomeInput = {
  taskId: string;
  runtime: NativePlanRuntime;
  session: ExecutionSessionRow;
  mainSessionId: string;
  taskSessionId: string;
  outcome: GraphDispatchOutcome;
  updateSessionState?: boolean;
};

function pausedStatus(status: PlanExecutionStatus): boolean {
  return ["waiting_for_user", "waiting_for_approval", "blocked"].includes(status);
}

function outcomeCurrentNodeId(
  status: PlanExecutionStatus,
  session: ExecutionSessionRow,
  outcome: GraphDispatchOutcome,
): string | null {
  if (status === "completed" || status === "cancelled") return null;
  const runningNodeId = currentNodeFromOutcome(outcome) ?? latestStartedNodeId(outcome.events);
  return status === "running" ? runningNodeId : runningNodeId ?? session.currentNodeId ?? null;
}

async function persistSessionState(
  input: FinalizeOutcomeInput,
  status: PlanExecutionStatus,
  currentNodeId: string | null,
  waitKind: WaitKind | undefined,
  tx: Prisma.TransactionClient,
) {
  if (input.updateSessionState === false) return;
  const transition = executionTransition({ status, pauseReason: waitKind });
  await setExecutionSessionState({
    sessionId: input.session.id,
    status: transition.sessionStatus,
    currentNodeId,
    pauseReason: transition.pauseReason,
    completedNodeIds: input.outcome.effective.completedNodeIds.filter(
      (nodeId) => input.outcome.effective.nodes.find((node) => node.id === nodeId)?.status !== "skipped",
    ),
  }, tx);
}


async function finalizeTerminalStatus(
  input: FinalizeOutcomeInput,
  status: PlanExecutionStatus,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (status === "completed") {
    await completeActiveRunsForExecutionScope({
      taskId: input.taskId,
      taskSessionId: input.taskSessionId,
      occurrenceId: input.session.occurrenceId,
      workBlockId: input.session.workBlockId,
      planRunId: input.runtime.persisted.id,
    }, tx);
    await completeWorkBlock(input.taskId, input.session.workBlockId, tx);
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: input.runtime.planId,
      sessionId: input.mainSessionId,
      workBlockId: input.session.workBlockId,
      eventType: "execution_completed",
      payload: { totalSteps: input.outcome.executedNodeIds.length, workBlockId: input.session.workBlockId },
    }, tx);
  }
  if (status === "cancelled") {
    await cancelActiveRunsForExecutionScope({
      taskId: input.taskId,
      taskSessionId: input.taskSessionId,
      occurrenceId: input.session.occurrenceId,
      workBlockId: input.session.workBlockId,
      reason: input.outcome.message,
      planRunId: input.runtime.persisted.id,
    }, tx);
    await releaseWorkBlock(input.taskId, input.session.workBlockId, tx);
  }
  if (status === "failed") {
    await terminalizePlanRunScopeInTransaction({
      taskId: input.taskId,
      workBlockId: input.session.workBlockId,
      planRunId: input.runtime.persisted.id,
      occurrenceId: input.session.occurrenceId,
      status: "Failed",
    }, tx);
  }
}

export type OutcomeFinalizationState = {
  status: PlanExecutionStatus;
  waitKind?: WaitKind;
  currentNodeId: string | null;
};

export async function commitOutcomeFinalizationInTransaction(
  input: FinalizeOutcomeInput,
  expectedPlanRunEpoch: number,
  tx: Prisma.TransactionClient,
): Promise<OutcomeFinalizationState | null> {
  const status = executionStatusFromGraphOutcome(input.outcome);
  const waitKind = pausedStatus(status) ? waitKindFromOutcome(input.outcome) : undefined;
  const currentNodeId = outcomeCurrentNodeId(status, input.session, input.outcome);
  const terminalSessionNodeId = status === "completed" || status === "cancelled" ? null : currentNodeId;
  const planRun = await tx.taskPlanRun.findFirst({
    where: {
      id: input.runtime.persisted.id,
      taskId: input.taskId,
      workBlockId: input.session.workBlockId,
      occurrenceId: input.session.occurrenceId ?? null,
      executionEpoch: expectedPlanRunEpoch,
    },
    select: { planRun: true },
  });
  const persisted = planRun?.planRun as { planRun?: { status?: unknown } } | null | undefined;
  if (persisted?.planRun?.status !== planRunStatusForExecutionStatus(status)) return null;
  await persistSessionState(input, status, terminalSessionNodeId, waitKind, tx);
  await finalizeTerminalStatus(input, status, tx);
  await rebuildTaskProjectionInTransaction(input.taskId, tx);
  return { status, waitKind, currentNodeId };
}

export function buildFinalizedOutcomeResponse(
  input: FinalizeOutcomeInput,
  state: OutcomeFinalizationState,
  planOutput: Pick<PlanOutputState, "manifest" | "finalizedResult" | "finalization" | "revision" | "updatedAt" | "updatedByNodeId">,
): PlanExecutionResult {
  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.runtime.planId,
    mainSessionId: input.mainSessionId,
    executionSessionId: input.session.id,
    planRunId: input.runtime.persisted.id,
    status: state.status,
    effective: input.outcome.effective,
    currentNodeId: state.currentNodeId,
    executedNodeIds: input.outcome.executedNodeIds,
    message: input.outcome.message,
    waitKind: state.waitKind,
    planOutput,
  });
}

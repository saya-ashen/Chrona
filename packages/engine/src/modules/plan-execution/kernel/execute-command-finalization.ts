import { db } from "@/lib/db";
import type { GraphDispatchOutcome } from "@chrona/graph-runtime";
import type { PlanExecutionResult, PlanExecutionStatus, WaitKind } from "@chrona/contracts/ai";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { executionStatusFromGraphOutcome, executionTransition } from "../execution-state-machine";
import { completeActiveRunsForTask, cancelActiveRunsForTask } from "../persistence/task-execution-store";
import { setExecutionSessionState, type ExecutionSessionRow } from "../persistence/execution-session-store";
import { completeWorkBlock, releaseWorkBlock } from "../persistence/work-block-store";
import { appendMainSessionEvent } from "../persistence/plan-state-store";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { buildExecutionResponse } from "../projection/execution-response";
import { currentNodeFromOutcome, latestStartedNodeId } from "../projection/execution-graph-selectors";
import { errorDetailsFromOutcome, waitKindFromOutcome } from "../runtime/runtime-outcome";
import type { NativePlanRuntime } from "../persistence/plan-runtime-store";

type FinalizeOutcomeInput = {
  taskId: string;
  runtime: NativePlanRuntime;
  session: ExecutionSessionRow;
  mainSessionId: string;
  outcome: GraphDispatchOutcome;
  updateSessionState?: boolean;
};

function pausedStatus(status: PlanExecutionStatus): boolean {
  return ["waiting_for_user", "waiting_for_approval", "blocked", "failed"].includes(status);
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

async function persistSessionState(input: FinalizeOutcomeInput, status: PlanExecutionStatus, currentNodeId: string | null, waitKind?: WaitKind) {
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
  });
}

async function finalizeTerminalStatus(input: FinalizeOutcomeInput, status: PlanExecutionStatus): Promise<void> {
  if (status === "completed") {
    await db.task.update({ where: { id: input.taskId }, data: { completedAt: new Date() } });
    await completeActiveRunsForTask(input.taskId);
    await completeWorkBlock(input.taskId, input.session.workBlockId);
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: input.runtime.planId,
      sessionId: input.mainSessionId,
      eventType: "execution_completed",
      payload: { totalSteps: input.outcome.executedNodeIds.length },
    });
  }
  if (status === "cancelled") {
    await cancelActiveRunsForTask(input.taskId, input.outcome.message);
    await releaseWorkBlock(input.taskId, input.session.workBlockId);
  }
}

export async function finalizeOutcome(input: FinalizeOutcomeInput): Promise<PlanExecutionResult> {
  const status = executionStatusFromGraphOutcome(input.outcome);
  const waitKind = pausedStatus(status) ? waitKindFromOutcome(input.outcome) : undefined;
  const currentNodeId = outcomeCurrentNodeId(status, input.session, input.outcome);
  const terminalSessionNodeId = status === "completed" || status === "cancelled" ? null : currentNodeId;
  await persistSessionState(input, status, terminalSessionNodeId, waitKind);
  await finalizeTerminalStatus(input, status);
  await rebuildTaskProjection(input.taskId);
  const latestExecution = await getCurrentExecution({ taskId: input.taskId, workBlockId: input.session.workBlockId });
  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.runtime.planId,
    mainSessionId: input.mainSessionId,
    executionSessionId: input.session.id,
    planRunId: input.runtime.persisted.id,
    status,
    effective: input.outcome.effective,
    currentNodeId,
    executedNodeIds: input.outcome.executedNodeIds,
    message: input.outcome.message,
    errorDetails: errorDetailsFromOutcome(input.outcome),
    waitKind,
    planOutput: latestExecution.planOutput,
  });
}

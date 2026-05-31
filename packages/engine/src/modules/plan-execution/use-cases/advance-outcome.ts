import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import type { GraphDispatchOutcome } from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  PlanExecutionResult,
  PlanGraph,
} from "@chrona/contracts/ai";
import { executionStatusFromGraphOutcome, executionTransition } from "../execution-state-machine";
import { getPlanRun } from "../plan-run-store";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import { setExecutionSessionState } from "../persistence/execution-session-store";
import { appendGraphRuntimeEvents } from "../persistence/runtime-event-store";
import { releaseWorkBlock } from "../persistence/work-block-store";
import { persistRuntimeState } from "../persistence/plan-runtime-store";
import type { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { markExecutionNodeActive } from "../persistence/task-execution-store";
import { buildExecutionResponse } from "../projection/execution-response";
import {
  currentNodeFromOutcome,
  latestStartedNodeId,
} from "../projection/execution-graph-selectors";
import {
  errorDetailsFromOutcome,
  waitKindFromOutcome,
} from "../runtime/runtime-outcome";
import {
  completeExecution,
  pauseExecution,
} from "./execution-lifecycle";
import type { PlanGraphCommandEnvelope } from "../types";

type NativePlanRuntime = NonNullable<Awaited<ReturnType<typeof ensureNativePlanRun>>>;

async function persistAdvanceOutcome(input: {
  taskId: string;
  mainSessionId: string;
  runtime: NativePlanRuntime;
  outcome: GraphDispatchOutcome;
  envelope: PlanGraphCommandEnvelope;
}) {
  await persistRuntimeState({
    workspaceId: input.runtime.workspaceId,
    taskId: input.taskId,
    planId: input.runtime.planId,
    compiledPlan: input.runtime.compiledPlan,
    graph: input.outcome.state.graph as unknown as PlanGraph,
    attempts: input.outcome.state.attempts as unknown as NodeAttempt[],
    results: input.outcome.state.results as unknown as NodeResult[],
    executionContextSnapshots: input.outcome.state
      .executionContextSnapshots as unknown as ExecutionContextSnapshot[],
    existingRun: input.runtime.persisted.planRun,
  });
  await appendGraphRuntimeEvents({
    taskId: input.taskId,
    planId: input.runtime.planId,
    sessionId: input.mainSessionId,
    events: input.outcome.events,
    envelope: input.envelope,
  });
}

async function cancelledAdvanceResponse(input: {
  taskId: string;
  mainSessionId: string;
  runtime: NativePlanRuntime;
  executionSession: ExecutionSessionRow;
  outcome: GraphDispatchOutcome;
}) {
  const latestEvidence = await latestPlanExecutionEvidence(input.taskId);
  const transition = executionTransition({
    status: "cancelled",
    message: input.outcome.message,
  });
  await setExecutionSessionState({
    sessionId: input.executionSession.id,
    status: transition.sessionStatus,
    currentNodeId: null,
    pauseReason: transition.pauseReason,
    completedNodeIds: input.outcome.effective.completedNodeIds,
    latestEventId: latestEvidence?.id ?? null,
    latestRawEventId: latestEvidence?.rawEventId ?? null,
  });
  await releaseWorkBlock(input.taskId, input.executionSession.workBlockId);
  await db.task.update({
    where: { id: input.taskId },
    data: { status: transition.taskStatus, blockReason: transition.blockReason },
  });
  await rebuildTaskProjection(input.taskId);

  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.runtime.planId,
    mainSessionId: input.executionSession.id,
    status: "cancelled",
    effective: input.outcome.effective as unknown as EffectivePlanGraph,
    currentNodeId: null,
    executedNodeIds: input.outcome.executedNodeIds,
    message: input.outcome.message,
    checkpoint: null,
  });
}

async function completedAdvanceResponse(input: {
  taskId: string;
  mainSessionId: string;
  runtime: NativePlanRuntime;
  executionSession: ExecutionSessionRow;
  outcome: GraphDispatchOutcome;
}) {
  return completeExecution({
    taskId: input.taskId,
    planId: input.runtime.planId,
    session: input.executionSession,
    workspaceId: input.runtime.workspaceId,
    compiledPlan: input.runtime.compiledPlan,
    persisted:
      await getPlanRun(input.taskId, input.runtime.planId) ??
      input.runtime.persisted,
    mainSessionId: input.mainSessionId,
    effective: input.outcome.effective as unknown as EffectivePlanGraph,
    executedNodeIds: input.outcome.executedNodeIds,
    message: input.outcome.message,
  });
}

async function runningAdvanceResponse(input: {
  taskId: string;
  mainSessionId: string;
  runtime: NativePlanRuntime;
  executionSession: ExecutionSessionRow;
  outcome: GraphDispatchOutcome;
}) {
  const currentNodeId =
    currentNodeFromOutcome(input.outcome) ??
    latestStartedNodeId(input.outcome.events);
  await markExecutionNodeActive({
    taskId: input.taskId,
    sessionId: input.executionSession.id,
    currentNodeId,
    completedNodeIds: input.outcome.effective.completedNodeIds,
  });
  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.runtime.planId,
    mainSessionId: input.mainSessionId,
    status: "running",
    effective: input.outcome.effective as unknown as EffectivePlanGraph,
    currentNodeId,
    executedNodeIds: input.outcome.executedNodeIds,
    message: input.outcome.message,
  });
}

function pausedCurrentNodeId(input: {
  outcome: GraphDispatchOutcome;
  executionSession: ExecutionSessionRow;
}) {
  return (
    currentNodeFromOutcome(input.outcome) ??
    input.executionSession.currentNodeId ??
    ""
  );
}

async function pausedAdvanceResponse(input: {
  taskId: string;
  mainSessionId: string;
  runtime: NativePlanRuntime;
  executionSession: ExecutionSessionRow;
  outcome: GraphDispatchOutcome;
}) {
  return pauseExecution({
    taskId: input.taskId,
    planId: input.runtime.planId,
    mainSessionId: input.mainSessionId,
    session: input.executionSession,
    effective: input.outcome.effective as unknown as EffectivePlanGraph,
    status: executionStatusFromGraphOutcome(input.outcome),
    waitKind: waitKindFromOutcome(input.outcome),
    currentNodeId: pausedCurrentNodeId(input),
    executedNodeIds: input.outcome.executedNodeIds,
    message: input.outcome.message,
    errorDetails: errorDetailsFromOutcome(input.outcome),
  });
}

export async function handleAdvanceOutcome(input: {
  taskId: string;
  mainSessionId: string;
  runtime: NativePlanRuntime;
  executionSession: ExecutionSessionRow;
  outcome: GraphDispatchOutcome;
  envelope: PlanGraphCommandEnvelope;
}): Promise<PlanExecutionResult> {
  await persistAdvanceOutcome(input);

  if (input.outcome.status === "cancelled") {
    return cancelledAdvanceResponse(input);
  }

  if (input.outcome.status === "completed") {
    return completedAdvanceResponse(input);
  }

  if (input.outcome.status === "running") {
    return runningAdvanceResponse(input);
  }

  return pausedAdvanceResponse(input);
}

async function latestPlanExecutionEvidence(taskId: string) {
  return db.event.findFirst({
    where: { taskId, source: "plan_execution" },
    orderBy: [{ ingestSequence: "desc" }],
    select: { id: true, rawEventId: true },
  });
}

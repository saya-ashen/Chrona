import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { appendMainSessionEvent } from "../plan-state-store";
import {
  executionStatusFromEffectiveGraph,
  executionStatusFromWaitKind,
  executionTransition,
} from "../execution-state-machine";
import type {
  CompiledPlan,
  EffectivePlanGraph,
  PlanExecutionResult,
  PlanExecutionStatus,
  WaitKind,
} from "@chrona/contracts/ai";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import type { PersistedPlanRun } from "../persistence/plan-runtime-store";
import { completeWorkBlock } from "../persistence/work-block-store";
import { setExecutionSessionState } from "../persistence/execution-session-store";
import { buildExecutionResponse } from "../projection/execution-response";
import {
  completedExecutionNodeIds,
  currentNodeFromEffective,
  toEffectivePlanGraph,
} from "../projection/execution-graph-selectors";
import {
  persistTerminalRuntimeState,
} from "../persistence/plan-runtime-store";
import {
  completeActiveRunsForTask,
  markExecutionNodeActive,
} from "../persistence/task-execution-store";

export async function convergeExecutionToCommittedState(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  session: ExecutionSessionRow;
  workspaceId: string;
  compiledPlan: CompiledPlan;
  committed: PersistedPlanRun;
  fallbackMessage: string;
}): Promise<PlanExecutionResult> {
  if (!input.committed.graph) {
    throw new Error("Plan runtime graph missing");
  }
  const effective = toEffectivePlanGraph({
    graph: input.committed.graph,
    attempts: input.committed.attempts,
    results: input.committed.results,
  });
  const status = executionStatusFromEffectiveGraph(effective);
  const currentNodeId =
    currentNodeFromEffective(effective)?.id ??
    input.committed.attempts.findLast((attempt) => attempt.status === "failed")?.nodeId ??
    "";

  if (status === "completed") {
    return completeExecution({
      taskId: input.taskId,
      planId: input.planId,
      session: input.session,
      workspaceId: input.workspaceId,
      compiledPlan: input.compiledPlan,
      persisted: input.committed,
      mainSessionId: input.mainSessionId,
      effective,
      executedNodeIds: effective.completedNodeIds,
      message: input.fallbackMessage,
    });
  }

  if (status === "running") {
    await markExecutionNodeActive({
      taskId: input.taskId,
      sessionId: input.session.id,
      currentNodeId: currentNodeId || null,
      completedNodeIds: effective.completedNodeIds,
    });
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: input.planId,
      mainSessionId: input.mainSessionId,
      status,
      effective,
      currentNodeId: currentNodeId || null,
      executedNodeIds: effective.completedNodeIds,
      message: input.fallbackMessage,
    });
  }

  return pauseExecution({
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    session: input.session,
    effective,
    status,
    waitKind:
      status === "waiting_for_user"
        ? "user_input"
        : status === "waiting_for_approval"
          ? "approval"
          : "manual_action",
    currentNodeId,
    executedNodeIds: effective.completedNodeIds,
    message: input.fallbackMessage,
  });
}

export async function pauseExecution(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  session: ExecutionSessionRow;
  effective: EffectivePlanGraph;
  status?: PlanExecutionStatus;
  waitKind?: WaitKind;
  currentNodeId: string;
  executedNodeIds: string[];
  message: string;
  errorDetails?: unknown;
}) {
  const executionStatus = input.status ?? executionStatusFromWaitKind(input.waitKind);
  const transition = executionTransition({
    status: executionStatus,
    pauseReason: input.waitKind,
    message: input.message,
    nodeId: input.currentNodeId,
  });

  await setExecutionSessionState({
    sessionId: input.session.id,
    status: transition.sessionStatus,
    currentNodeId: input.currentNodeId,
    pauseReason: transition.pauseReason,
    completedNodeIds: completedExecutionNodeIds(input.effective),
  });

  await db.task.update({
    where: { id: input.taskId },
    data: {
      status: transition.taskStatus,
      blockReason: transition.blockReason,
    },
  });

  await rebuildTaskProjection(input.taskId);

  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    executionSessionId: input.session.id,
    planRunId: input.planId,
    status: executionStatus,
    effective: input.effective,
    currentNodeId: input.currentNodeId,
    executedNodeIds: input.executedNodeIds,
    message: input.message,
    errorDetails: input.errorDetails,
    waitKind: input.waitKind,
  });
}

export async function completeExecution(input: {
  taskId: string;
  planId: string;
  session: ExecutionSessionRow;
  workspaceId?: string;
  compiledPlan?: CompiledPlan;
  persisted?: PersistedPlanRun;
  mainSessionId: string;
  effective: EffectivePlanGraph;
  executedNodeIds: string[];
  message: string;
}) {
  const status = executionStatusFromEffectiveGraph(input.effective);
  const transition = executionTransition({
    status,
    message: input.message,
  });
  if (input.workspaceId && input.compiledPlan && input.persisted) {
    await persistTerminalRuntimeState({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.planId,
      compiledPlan: input.compiledPlan,
      persisted: input.persisted,
      effective: input.effective,
      status,
    });
  }
  await setExecutionSessionState({
    sessionId: input.session.id,
    status: transition.sessionStatus,
    currentNodeId: null,
    pauseReason: transition.pauseReason,
    completedNodeIds: completedExecutionNodeIds(input.effective),
  });

  if (status === "completed") {
    await completeActiveRunsForTask(input.taskId);
  }

  await db.task.update({
    where: { id: input.taskId },
    data: {
      status: transition.taskStatus,
      completedAt: status === "completed" ? new Date() : undefined,
      blockReason: transition.blockReason,
    },
  });

  if (status === "completed") {
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: input.planId,
      sessionId: input.mainSessionId,
      eventType: "execution_completed",
      payload: { totalSteps: input.executedNodeIds.length },
    });
    await completeWorkBlock(input.taskId, input.session.workBlockId);
  }

  await rebuildTaskProjection(input.taskId);

  return buildExecutionResponse({
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    status,
    effective: input.effective,
    currentNodeId: null,
    executedNodeIds: input.executedNodeIds,
    message: input.message,
  });
}

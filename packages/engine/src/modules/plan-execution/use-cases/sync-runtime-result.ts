import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { createGraphRuntime } from "@chrona/graph-runtime";
import {
  executionStatusFromGraphOutcome,
  executionTransition,
} from "../execution-state-machine";
import type {
  EffectivePlanGraph,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
  PlanGraph,
} from "@chrona/contracts/ai";
import type {
  EngineRuntimeContext,
  SyncPlanRunRuntimeResultInput,
} from "../types";
import { ensurePlanMainSession } from "../plan-state-store";
import { getPlanRun } from "../plan-run-store";
import {
  ensureNativePlanRun,
  persistRuntimeState,
} from "../persistence/plan-runtime-store";
import { setExecutionSessionState } from "../persistence/execution-session-store";
import { appendGraphRuntimeEvents } from "../persistence/runtime-event-store";
import { markExecutionNodeActive } from "../persistence/task-execution-store";
import { getRuntimeName } from "../persistence/task-runtime-store";
import { currentNodeFromOutcome } from "../projection/execution-graph-selectors";
import { toGraphExecutionState } from "../runtime/graph-state";
import { waitKindFromOutcome } from "../runtime/runtime-outcome";
import { completeExecution } from "./execution-lifecycle";

const DEFAULT_MAX_STEPS = 10;

type RunningRuntimeAttempt = NodeAttempt & {
  runtimeSnapshot?: { output?: unknown } | null;
};

function runtimeRunRefFromAttempt(attempt: NodeAttempt) {
  const output = (attempt as RunningRuntimeAttempt).runtimeSnapshot?.output;
  if (!output || typeof output !== "object") return null;

  const record = output as Record<string, unknown>;
  return typeof record.runtimeRunRef === "string" ? record.runtimeRunRef : null;
}

function runningAttemptForRuntimeRun(input: {
  attempts: NodeAttempt[];
  runtimeRunRef: string;
}) {
  return input.attempts.find(
    (attempt) =>
      attempt.status === "running" &&
      runtimeRunRefFromAttempt(attempt) === input.runtimeRunRef,
  );
}

function externalResultForRuntimeRun(input: {
  attempt: NodeAttempt;
  mainSessionId: string;
  runtimeRunRef: string;
  status: SyncPlanRunRuntimeResultInput["status"];
  summary?: string;
  output?: unknown;
  error?: string;
}) {
  const evidence = {
    sessionId: input.mainSessionId,
    runId: input.runtimeRunRef,
  };

  if (input.status === "Completed") {
    return {
      nodeId: input.attempt.nodeId,
      status: "done" as const,
      summary:
        input.summary?.trim() ||
        `Runtime run ${input.runtimeRunRef} completed`,
      evidence,
      output: input.output,
    };
  }

  if (input.status === "Cancelled") {
    return {
      nodeId: input.attempt.nodeId,
      status: "cancelled" as const,
      reason:
        input.error?.trim() ||
        `Runtime run ${input.runtimeRunRef} was cancelled`,
      evidence,
    };
  }

  return {
    nodeId: input.attempt.nodeId,
    status: "failed" as const,
    error:
      input.error?.trim() ||
      `Runtime run ${input.runtimeRunRef} failed`,
    evidence,
  };
}

async function markTaskCompleted(taskId: string) {
  await db.task.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.Completed,
      completedAt: new Date(),
      blockReason: Prisma.DbNull,
    },
  });
  await rebuildTaskProjection(taskId);
}

async function pauseSyncedExecution(input: {
  taskId: string;
  attempt: NodeAttempt;
  executionSessionId?: string;
  outcome: Awaited<ReturnType<ReturnType<typeof createGraphRuntime<EngineRuntimeContext>>["dispatch"]>>;
}) {
  const executionStatus = executionStatusFromGraphOutcome(input.outcome);
  if (executionStatus === "completed" || executionStatus === "running") return;

  const transition = executionTransition({
    status: executionStatus,
    pauseReason: waitKindFromOutcome(input.outcome),
    message: input.outcome.message,
    nodeId: input.outcome.currentNodeId ?? input.attempt.nodeId,
  });
  if (input.executionSessionId) {
    await setExecutionSessionState({
      sessionId: input.executionSessionId,
      status: transition.sessionStatus,
      currentNodeId: input.outcome.currentNodeId ?? input.attempt.nodeId,
      pauseReason: transition.pauseReason,
      completedNodeIds: input.outcome.effective.completedNodeIds,
    });
  }
  await db.task.update({
    where: { id: input.taskId },
    data: {
      status: transition.taskStatus,
      blockReason: transition.blockReason,
    },
  });
  await rebuildTaskProjection(input.taskId);
}

export async function syncPlanRunRuntimeResult(
  input: SyncPlanRunRuntimeResultInput,
): Promise<void> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) return;

  const state = toGraphExecutionState(runtime.persisted);
  const attempt = runningAttemptForRuntimeRun({
    attempts: state.attempts as unknown as NodeAttempt[],
    runtimeRunRef: input.runtimeRunRef,
  });
  if (!attempt) return;

  const runtimeName = await getRuntimeName(input.taskId);
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
    runtimeName,
  });
  const executionSession = await db.executionSession.findFirst({
    where: { taskId: input.taskId, planId: runtime.planId },
    orderBy: { updatedAt: "desc" },
  });
  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId: input.taskId,
    runtimeName,
    policies: { maxSteps: DEFAULT_MAX_STEPS },
    callbacks: {
      executeNode: async () => null,
    },
  });
  const context: EngineRuntimeContext = {
    taskId: input.taskId,
    planId: runtime.planId,
    mainSession,
  };
  const externalResult = externalResultForRuntimeRun({
    attempt,
    mainSessionId: mainSession.id,
    runtimeRunRef: input.runtimeRunRef,
    status: input.status,
    summary: input.summary ?? undefined,
    output: input.output,
    error: input.error ?? undefined,
  });
  const outcome = await graphRuntime.dispatch({
    type: "sync_external_result",
    state,
    trigger: "system",
    context,
    externalResult,
  });

  await persistRuntimeState({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    compiledPlan: runtime.compiledPlan,
    graph: outcome.state.graph as unknown as PlanGraph,
    attempts: outcome.state.attempts as unknown as NodeAttempt[],
    results: outcome.state.results as unknown as NodeResult[],
    executionContextSnapshots: outcome.state
      .executionContextSnapshots as unknown as ExecutionContextSnapshot[],
    existingRun: runtime.persisted.planRun,
  });
  await appendGraphRuntimeEvents({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    events: outcome.events,
  });

  if (outcome.status === "completed") {
    if (executionSession) {
      await completeExecution({
        taskId: input.taskId,
        planId: runtime.planId,
        session: executionSession,
        workspaceId: runtime.workspaceId,
        compiledPlan: runtime.compiledPlan,
        persisted: await getPlanRun(input.taskId, runtime.planId) ?? runtime.persisted,
        mainSessionId: mainSession.id,
        effective: outcome.effective as unknown as EffectivePlanGraph,
        executedNodeIds: outcome.executedNodeIds,
        message: outcome.message,
      });
      return;
    }

    await markTaskCompleted(input.taskId);
    return;
  }

  if (outcome.status === "running") {
    await markExecutionNodeActive({
      taskId: input.taskId,
      sessionId: executionSession?.id,
      currentNodeId: currentNodeFromOutcome(outcome),
      completedNodeIds: outcome.effective.completedNodeIds,
    });
    return;
  }

  await pauseSyncedExecution({
    taskId: input.taskId,
    attempt,
    executionSessionId: executionSession?.id,
    outcome,
  });
}

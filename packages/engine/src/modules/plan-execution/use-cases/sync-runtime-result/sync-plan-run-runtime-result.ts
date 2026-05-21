import { db } from "@/lib/db";
import { createGraphRuntime } from "@chrona/graph-runtime";
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
} from "../../types";
import { ensurePlanMainSession } from "../../plan-state-store";
import { getPlanRun } from "../../plan-run-store";
import {
  ensureNativePlanRun,
  persistRuntimeState,
} from "../../persistence/plan-runtime-store";
import { appendGraphRuntimeEvents } from "../../persistence/runtime-event-store";
import { markExecutionNodeActive } from "../../persistence/task-execution-store";
import { getRuntimeName } from "../../persistence/task-runtime-store";
import { currentNodeFromOutcome } from "../../projection/execution-graph-selectors";
import { toGraphExecutionState } from "../../runtime/graph-state";
import { completeExecution } from "../execution-lifecycle";
import { runningAttemptForRuntimeRun } from "./attempts";
import { externalResultForRuntimeRun } from "./external-result";
import { markTaskCompleted } from "./mark-task-completed";
import { pauseSyncedExecution } from "./pause-synced-execution";

const DEFAULT_MAX_STEPS = 10;

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
        persisted: (await getPlanRun(input.taskId, runtime.planId)) ?? runtime.persisted,
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

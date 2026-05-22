import { createGraphRuntime } from "@chrona/graph-runtime";
import type { NodeAttempt } from "@chrona/contracts/ai";
import type {
  EngineRuntimeContext,
  SyncPlanRunRuntimeResultInput,
} from "../../types";
import { ensurePlanMainSession } from "../../plan-state-store";
import { ensureNativePlanRun } from "../../persistence/plan-runtime-store";
import { getRuntimeName } from "../../persistence/task-runtime-store";
import { ensureExecutionSession } from "../../persistence/execution-session-store";
import { toGraphExecutionState } from "../../runtime/graph-state";
import { createExecutionGraphCallbacks } from "../../runtime/graph-runtime-callbacks";
import { committedStateIfRunningNodeAdvanced } from "../../runtime/committed-state";
import { handleAdvanceOutcome } from "../advance-outcome";
import { runningAttemptForRuntimeRun } from "./attempts";
import { externalResultForRuntimeRun } from "./external-result";

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
  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: "system",
  });
  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId: input.taskId,
    runtimeName,
    policies: { maxSteps: DEFAULT_MAX_STEPS },
    callbacks: createExecutionGraphCallbacks({
      taskId: input.taskId,
      planId: runtime.planId,
      workspaceId: runtime.workspaceId,
      compiledPlan: runtime.compiledPlan,
      persisted: runtime.persisted,
      runtimeName,
      trigger: "system",
      mainSession,
      executionSession,
      committedStateIfRunningNodeAdvanced,
    }),
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

  await handleAdvanceOutcome({
    taskId: input.taskId,
    mainSessionId: mainSession.id,
    runtime,
    executionSession,
    outcome,
  });
}

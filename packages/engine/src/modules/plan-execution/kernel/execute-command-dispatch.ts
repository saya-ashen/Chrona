import { createGraphRuntime, resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { ExecutionCommandContext, ExecutionCommandEnvelope, PlanExecutionResult } from "@chrona/contracts/ai";
import { toGraphExecutionState } from "../runtime/graph-state";
import { getCurrentExecution } from "../use-cases/get-current-execution";
import { buildGraphCommand } from "./execute-command-graph-command";
import { createKernelGraphCallbacks } from "./graph-callbacks";
import type { EngineRuntimeContext, PlanExecutionObserver } from "./kernel-types";
import { persistAndFinalizeOutcome } from "./execute-command-outcome";
import type { PreparedCommandExecution } from "./execute-command-setup";
import { StaleRuntimeResultSyncError } from "./runtime-result-sync-errors";

const DEFAULT_MAX_STEPS = 10;

function staleRuntimeResultError(input: {
  taskId: string;
  command: ExecutionCommandEnvelope["command"];
  session: PreparedCommandExecution["session"];
}) {
  const { command, taskId, session } = input;
  if (command.type !== "submit_node_result" || !command.runtimeRunRef || session.status === "Active") return;
  throw new StaleRuntimeResultSyncError({ taskId, runtimeRunRef: command.runtimeRunRef }, "inactive_session");
}

async function unresolvedGraphCommandResult(input: {
  taskId: string;
  workBlockId: string | null;
}): Promise<PlanExecutionResult> {
  const current = await getCurrentExecution(input);
  return current.status === "completed" || current.status === "cancelled"
    ? { ...current, message: "Execution already completed; node result ignored." }
    : current;
}

export async function dispatchExecutionCommand(input: {
  taskId: string;
  command: ExecutionCommandEnvelope["command"];
  context: ExecutionCommandContext;
  observer: PlanExecutionObserver;
  prepared: PreparedCommandExecution;
}): Promise<PlanExecutionResult> {
  const { taskId, command, context, observer, prepared } = input;
  const {
    trigger,
    runtime,
    goalContext,
    session,
    mainSession,
    runtimeName,
    existingContextSession,
    contextSessionId,
  } = prepared;
  staleRuntimeResultError({ taskId, command, session });

  const state = toGraphExecutionState(runtime.persisted);
  const graphCommand = buildGraphCommand({
    command,
    state,
    effective: resolveEffectivePlanGraph(state),
    session,
    engineContext: { taskId, planId: runtime.planId, mainSession },
    trigger,
  });
  if (!graphCommand) return unresolvedGraphCommandResult({ taskId, workBlockId: session.workBlockId });

  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId,
    runtimeName,
    policies: { maxSteps: DEFAULT_MAX_STEPS },
    callbacks: createKernelGraphCallbacks({
      taskId,
      sessionId: session.id,
      runtimeName,
      mainSession,
      workspaceId: runtime.workspaceId,
      workBlockId: session.workBlockId,
      planId: runtime.planId,
      compiledPlan: runtime.compiledPlan,
      persisted: runtime.persisted,
      planSummary: runtime.planSummary,
      goalContext,
      initialRunContext: command.type === "start" || command.type === "restart_from_beginning"
        ? {
            ...(runtime.planPrompt ? { planningPrompt: runtime.planPrompt } : {}),
            ...(command.prompt ? { startPrompt: command.prompt } : {}),
          }
        : undefined,
      updateSessionProjection: !(existingContextSession && contextSessionId !== session.id),
      onGraphEvent: observer.onGraphEvent,
      onRuntimeEvent: observer.onRuntimeEvent,
      onStateChange: observer.onStateChange,
    }),
  });
  const outcome = await graphRuntime.dispatch(graphCommand);
  return persistAndFinalizeOutcome({
    taskId,
    runtime,
    session,
    mainSession,
    command,
    context,
    existingContextSession,
    contextSessionId,
    outcome,
  });
}

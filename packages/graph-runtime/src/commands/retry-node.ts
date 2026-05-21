import { resolveEffectivePlanGraph } from "../resolve";
import { runGraphExecution } from "../execution/run-graph-execution";
import { retryNodeState } from "./state-updates";
import type { GraphExecutionCallbacks, GraphExecutionEvent } from "../execution/types";
import type { GraphDispatchOutcome, GraphRuntimeCommand, GraphRuntimeOptions } from "./types";

export async function retryNodeCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "retry_node" }>;
  options: GraphRuntimeOptions<TContext>;
  callbacks: GraphExecutionCallbacks<TContext>;
  events: GraphExecutionEvent[];
}): Promise<GraphDispatchOutcome> {
  const maxAttempts = input.options.policies?.retry?.maxAttempts;
  const attemptCount = input.command.state.attempts.filter(
    (attempt) => attempt.nodeId === input.command.nodeId,
  ).length;
  if (maxAttempts !== undefined && attemptCount >= maxAttempts) {
    const effective = resolveEffectivePlanGraph(input.command.state);
    return {
      status: "blocked",
      currentNodeId: input.command.nodeId,
      executedNodeIds: [],
      effective,
      state: input.command.state,
      events: input.events,
      message: `Retry limit reached for node ${input.command.nodeId}: ${attemptCount}/${maxAttempts}`,
    };
  }

  const retryState = retryNodeState({
    state: input.command.state,
    nodeId: input.command.nodeId,
    reason: input.command.reason ?? "Retry requested",
    finishedAt: new Date(input.options.now?.() ?? Date.now()).toISOString(),
  });
  const outcome = await runGraphExecution({
    taskId: input.options.taskId,
    runtimeName: input.options.runtimeName,
    trigger: input.command.trigger ?? "manual",
    state: retryState,
    context: input.command.context as TContext,
    maxSteps: input.options.policies?.maxSteps,
    maxConcurrency: input.options.policies?.maxConcurrency,
    forcedNodeId: input.command.nodeId,
    userInput: input.command.userInput,
    now: input.options.now,
    callbacks: input.callbacks,
  });
  return { ...outcome, events: input.events };
}

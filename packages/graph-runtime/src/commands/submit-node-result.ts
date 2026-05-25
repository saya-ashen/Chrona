import { resolveEffectivePlanGraph } from "../resolve";
import { runGraphExecution } from "../execution/run-graph-execution";
import { mapTerminalReasonToGraphStatus } from "../status";
import { submitNodeResultState } from "./state-updates";
import type { GraphExecutionCallbacks, GraphExecutionEvent } from "../execution/types";
import type { GraphDispatchOutcome, GraphRuntimeCommand, GraphRuntimeOptions } from "./types";

export async function submitNodeResultCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "submit_node_result" }>;
  options: GraphRuntimeOptions<TContext>;
  callbacks: GraphExecutionCallbacks<TContext>;
  events: GraphExecutionEvent[];
}): Promise<GraphDispatchOutcome> {
  const submittedAt = new Date(
    input.options.now?.() ?? Date.now(),
  ).toISOString();
  const submittedState = submitNodeResultState({
    taskId: input.options.taskId,
    state: input.command.state,
    nodeResult: input.command.nodeResult,
    submittedAt,
  });
  input.events.push({
    type: "node_result_submitted",
    nodeId: input.command.nodeResult.nodeId,
    status: input.command.nodeResult.status,
  });
  if (input.command.nodeResult.status !== "done" || input.command.continueExecution === false) {
    const effective = resolveEffectivePlanGraph(submittedState);
    const waitKind =
      input.command.nodeResult.status === "blocked"
        ? "manual_action"
        : undefined;
    const terminalStatus = mapTerminalReasonToGraphStatus(effective);
    return {
      status:
        input.command.nodeResult.status === "done"
          ? terminalStatus === "completed"
            ? "completed"
            : "running"
          : input.command.nodeResult.status === "blocked"
            ? "blocked"
            : "failed",
      currentNodeId: input.command.nodeResult.status === "done" ? null : input.command.nodeResult.nodeId,
      executedNodeIds: [],
      effective,
      state: submittedState,
      events: input.events,
      waitKind,
      message:
        input.command.nodeResult.status === "done"
          ? "Node result accepted. Continuation pending."
          : input.command.nodeResult.status === "failed"
            ? input.command.nodeResult.error
            : input.command.nodeResult.status === "cancelled"
              ? (input.command.nodeResult.reason ?? "External work cancelled")
              : input.command.nodeResult.reason,
    };
  }
  const outcome = await runGraphExecution({
    taskId: input.options.taskId,
    runtimeName: input.options.runtimeName,
    trigger: input.command.trigger ?? "system",
    state: submittedState,
    context: input.command.context as TContext,
    maxSteps: input.options.policies?.maxSteps,
    maxConcurrency: input.options.policies?.maxConcurrency,
    now: input.options.now,
    callbacks: input.callbacks,
  });
  return { ...outcome, events: input.events };
}

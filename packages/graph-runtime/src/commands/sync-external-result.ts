import { resolveEffectivePlanGraph } from "../resolve";
import { runGraphExecution } from "../execution/run-graph-execution";
import { mapTerminalReasonToGraphStatus } from "../status";
import { syncExternalResultState } from "./state-updates";
import type { GraphExecutionCallbacks, GraphExecutionEvent } from "../execution/types";
import type { GraphDispatchOutcome, GraphRuntimeCommand, GraphRuntimeOptions } from "./types";

export async function syncExternalResultCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "sync_external_result" }>;
  options: GraphRuntimeOptions<TContext>;
  callbacks: GraphExecutionCallbacks<TContext>;
  events: GraphExecutionEvent[];
}): Promise<GraphDispatchOutcome> {
  const syncedAt = new Date(
    input.options.now?.() ?? Date.now(),
  ).toISOString();
  const syncedState = syncExternalResultState({
    taskId: input.options.taskId,
    state: input.command.state,
    externalResult: input.command.externalResult,
    syncedAt,
  });
  input.events.push({
    type: "external_result_synced",
    nodeId: input.command.externalResult.nodeId,
    status: input.command.externalResult.status,
  });
  if (input.command.externalResult.status !== "done" || input.command.continueExecution === false) {
    const effective = resolveEffectivePlanGraph(syncedState);
    const waitKind =
      input.command.externalResult.status === "blocked"
        ? "manual_action"
        : undefined;
    const terminalStatus = mapTerminalReasonToGraphStatus(effective);
    return {
      status:
        input.command.externalResult.status === "done"
          ? terminalStatus === "completed"
            ? "completed"
            : "running"
          : input.command.externalResult.status === "blocked"
            ? "blocked"
            : "failed",
      currentNodeId: input.command.externalResult.status === "done" ? null : input.command.externalResult.nodeId,
      executedNodeIds: [],
      effective,
      state: syncedState,
      events: input.events,
      waitKind,
      message:
        input.command.externalResult.status === "done"
          ? "External result accepted. Continuation pending."
          : input.command.externalResult.status === "failed"
            ? input.command.externalResult.error
            : input.command.externalResult.status === "cancelled"
              ? (input.command.externalResult.reason ??
                "External work cancelled")
              : input.command.externalResult.reason,
    };
  }
  const outcome = await runGraphExecution({
    taskId: input.options.taskId,
    runtimeName: input.options.runtimeName,
    trigger: input.command.trigger ?? "system",
    state: syncedState,
    context: input.command.context as TContext,
    maxSteps: input.options.policies?.maxSteps,
    maxConcurrency: input.options.policies?.maxConcurrency,
    now: input.options.now,
    callbacks: input.callbacks,
  });
  return { ...outcome, events: input.events };
}

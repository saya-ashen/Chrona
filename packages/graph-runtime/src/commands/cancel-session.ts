import { resolveEffectivePlanGraph } from "../resolve";
import { cancelSessionState } from "./state-updates";
import type { GraphExecutionEvent } from "../execution/types";
import type { GraphDispatchOutcome, GraphRuntimeCommand, GraphRuntimeOptions } from "./types";

export function cancelSessionCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "cancel_session" }>;
  options: GraphRuntimeOptions<TContext>;
  events: GraphExecutionEvent[];
}): GraphDispatchOutcome {
  const cancelledState = cancelSessionState({
    state: input.command.state,
    reason: input.command.reason ?? "Session cancelled",
    finishedAt: new Date(input.options.now?.() ?? Date.now()).toISOString(),
  });
  return {
    status: "cancelled",
    currentNodeId: null,
    executedNodeIds: [],
    effective: resolveEffectivePlanGraph(cancelledState),
    state: cancelledState,
    events: input.events,
    message: input.command.reason ?? "Session cancelled",
  };
}

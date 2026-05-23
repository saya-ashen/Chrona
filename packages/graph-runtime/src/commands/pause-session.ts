import { resolveEffectivePlanGraph } from "../resolve";
import type {
  GraphDispatchOutcome,
  GraphRuntimeCommand,
  GraphRuntimeOptions,
} from "./types";
import type { GraphExecutionEvent } from "../execution/types";

export function pauseSessionCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "pause_session" }>;
  options: GraphRuntimeOptions<TContext>;
  events: GraphExecutionEvent[];
}): GraphDispatchOutcome {
  const effective = resolveEffectivePlanGraph(input.command.state);

  return {
    status: "blocked",
    currentNodeId: null,
    executedNodeIds: [],
    effective,
    state: input.command.state,
    events: input.events,
    waitKind: "manual_action",
    message: input.command.reason ?? "Execution paused",
  };
}

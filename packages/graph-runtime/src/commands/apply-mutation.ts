import {
  applyDownstreamInvalidation,
  planDownstreamInvalidation,
} from "../invalidation";
import { applyGraphMutation } from "../mutations";
import { resolveEffectivePlanGraph } from "../resolve";
import { mapTerminalReasonToGraphStatus } from "../status";
import type { GraphExecutionEvent } from "../execution/types";
import type { GraphDispatchOutcome, GraphRuntimeCommand, GraphRuntimeOptions } from "./types";

export function applyMutationCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "apply_mutation" }>;
  options: GraphRuntimeOptions<TContext>;
  events: GraphExecutionEvent[];
}): GraphDispatchOutcome {
  const mutationResult = applyGraphMutation({
    graph: input.command.state.graph,
    operations: input.command.mutation.operations,
    reason: input.command.mutation.reason,
    now: new Date(input.options.now?.() ?? Date.now()).toISOString(),
  });
  input.events.push({
    type: "graph_mutation_applied",
    mutationId: mutationResult.mutation.id,
    affectedNodeIds: mutationResult.mutation.affectedNodeIds,
  });
  let state = { ...input.command.state, graph: mutationResult.graph };
  if (input.command.mutation.invalidateDownstream) {
    state = applyDownstreamInvalidation({
      state,
      mutationId: mutationResult.mutation.id,
      plan: planDownstreamInvalidation({
        graph: mutationResult.graph,
        changedNodeIds: mutationResult.mutation.affectedNodeIds,
        reason: input.command.mutation.reason,
      }),
      now: mutationResult.mutation.createdAt,
    });
  }
  const effective = resolveEffectivePlanGraph(state);
  return {
    status: mapTerminalReasonToGraphStatus(effective),
    currentNodeId: null,
    executedNodeIds: [],
    effective,
    state,
    events: input.events,
    message: `Graph mutation applied: ${mutationResult.mutation.id}`,
  };
}

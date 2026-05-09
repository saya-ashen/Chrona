import { getDownstreamNodeIds } from "./transitions";
import type {
  DownstreamInvalidationInput,
  DownstreamInvalidationPlan,
  EdgeType,
  NodeCancellationLayer,
  NodeInvalidationLayer,
} from "./types";
import type { GraphExecutionState } from "./graph-runner";

const DEFAULT_INVALIDATION_EDGE_TYPES: EdgeType[] = ["hard_dependency", "branch"];

export type ApplyDownstreamInvalidationInput = {
  state: GraphExecutionState;
  plan: DownstreamInvalidationPlan;
  now?: string;
  mutationId?: string;
};

export function planDownstreamInvalidation(
  input: DownstreamInvalidationInput,
): DownstreamInvalidationPlan {
  const invalidatedNodeIds = getDownstreamNodeIds(input.graph, input.changedNodeIds, {
    edgeTypes: input.edgeTypes ?? DEFAULT_INVALIDATION_EDGE_TYPES,
  });
  return {
    rootNodeIds: input.changedNodeIds,
    invalidatedNodeIds,
    reason: input.reason,
  };
}

export function applyDownstreamInvalidation(
  input: ApplyDownstreamInvalidationInput,
): GraphExecutionState {
  const now = input.now ?? new Date().toISOString();
  const invalidated = new Set(input.plan.invalidatedNodeIds);
  if (invalidated.size === 0) return input.state;

  return {
    ...input.state,
    graph: {
      ...input.state.graph,
      nodes: input.state.graph.nodes.map((node) => {
        if (!invalidated.has(node.id)) return node;
        const invalidationLayer: NodeInvalidationLayer = {
          id: `invalidation_${node.id}_${now}`,
          nodeId: node.id,
          type: "invalidation",
          createdAt: now,
          createdBy: "system",
          reason: input.plan.reason,
          invalidatedByMutationId: input.mutationId,
        };
        const runningAttempt = input.state.attempts.find(
          (attempt) => attempt.nodeId === node.id && attempt.status === "running",
        );
        const cancellationLayer: NodeCancellationLayer | null = runningAttempt
          ? {
              id: `cancellation_${node.id}_${now}`,
              nodeId: node.id,
              type: "cancellation",
              createdAt: now,
              createdBy: "system",
              reason: input.plan.reason,
              cancelledAttemptId: runningAttempt.id,
            }
          : null;
        return {
          ...node,
          layers: cancellationLayer
            ? [...node.layers, invalidationLayer, cancellationLayer]
            : [...node.layers, invalidationLayer],
          updatedAt: now,
        };
      }),
      updatedAt: now,
    },
    attempts: input.state.attempts.map((attempt) =>
      invalidated.has(attempt.nodeId) && attempt.status === "running"
        ? {
            ...attempt,
            status: "cancelled",
            finishedAt: now,
            error: { code: "NODE_INVALIDATED", message: input.plan.reason },
          }
        : attempt,
    ),
    results: input.state.results.map((result) =>
      result.nodeId && invalidated.has(result.nodeId) && result.status === "current"
        ? { ...result, status: "invalidated" }
        : result,
    ),
  };
}

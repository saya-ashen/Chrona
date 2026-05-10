import type {
  EffectivePlanGraph,
  ExecutionContextSnapshot,
  NodeAttempt,
  NodeResult,
} from "./types";

export function pickNextNodeId(
  effective: EffectivePlanGraph,
  forcedNodeId?: string,
): string | null {
  if (forcedNodeId) {
    const forced = effective.nodes.find((node) => node.id === forcedNodeId);
    if (forced && forced.reachable) {
      return forcedNodeId;
    }
  }
  return effective.readyNodeIds.length > 0 ? effective.readyNodeIds[0] : null;
}

export function markNodeResults(
  results: NodeResult[],
  nodeId: string,
  nextStatus: NonNullable<NodeResult["status"]>,
): NodeResult[] {
  return results.map((result) =>
    result.nodeId === nodeId && result.status === "current"
      ? { ...result, status: nextStatus }
      : result,
  );
}

export function appendCurrentResult(input: {
  results: NodeResult[];
  result: NodeResult;
  replaceStatus?: NonNullable<NodeResult["status"]>;
}): NodeResult[] {
  const nextResults = markNodeResults(
    input.results,
    input.result.nodeId ?? "",
    input.replaceStatus ?? "obsolete",
  );
  nextResults.push(input.result);
  return nextResults;
}

export function updateAttemptStatus(input: {
  attempts: NodeAttempt[];
  attemptId: string;
  status: NodeAttempt["status"];
  finishedAt?: string;
  error?: NodeAttempt["error"];
  runtimeSnapshot?: Record<string, unknown>;
}): NodeAttempt[] {
  return input.attempts.map((attempt) =>
    attempt.id === input.attemptId
      ? {
          ...attempt,
          status: input.status,
          finishedAt: input.finishedAt ?? attempt.finishedAt,
          runtimeSnapshot: input.runtimeSnapshot ?? attempt.runtimeSnapshot,
          ...(input.error ? { error: input.error } : {}),
        }
      : attempt,
  );
}

export function cancelActiveAttempt(
  attempts: NodeAttempt[],
  nodeId: string,
  reason: string,
): NodeAttempt[] {
  const finishedAt = new Date().toISOString();
  return attempts.map((attempt) =>
    attempt.nodeId === nodeId && attempt.status === "running"
      ? {
          ...attempt,
          status: "cancelled",
          finishedAt,
          error: {
            code: "EXECUTION_CANCELLED",
            message: reason,
          },
        }
      : attempt,
  );
}

export function createExecutionContextSnapshot(input: {
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  graphVersion: number;
  runtimeName: string;
  userInput?: string;
  now?: number;
}): ExecutionContextSnapshot {
  const now = input.now ?? Date.now();
  const createdAt = new Date(now).toISOString();
  return {
    id: `ctx_${input.graphId}_${input.nodeId}_${now}`,
    graphId: input.graphId,
    nodeId: input.nodeId,
    nodeLayerId: input.nodeLayerId,
    graphSignature: `${input.graphId}:${input.graphVersion}:${input.nodeLayerId}`,
    refs: input.userInput ? { userInput: input.userInput } : undefined,
    runtimeSnapshot: { runtimeName: input.runtimeName },
    createdAt,
  };
}

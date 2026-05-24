import { appendCurrentResult, markNodeResults, updateAttemptStatus } from "../execution-state";
import { normalizeResultEvidence } from "../evidence";
import { resolveEffectivePlanGraph } from "../resolve";
import type { GraphExecutionState, GraphExternalSyncResult } from "../execution/types";
import type { NodeAttempt, NodeResult } from "../types";
import { normalizeResultOutputs } from "../execution/result-normalization";

export function approveCurrentNodeResult(input: {
  state: GraphExecutionState;
  nodeId: string;
  approved: boolean;
  feedback?: string;
  reviewedAt: string;
}): GraphExecutionState {
  const nextResults: NodeResult[] = [];
  for (const result of input.state.results) {
    if (result.nodeId !== input.nodeId || result.status !== "current") {
      nextResults.push(result);
      continue;
    }
    if (!result.review && !result.waitKind) {
      nextResults.push(result);
      continue;
    }
    const reviewedResult: NodeResult = {
      ...result,
      status: input.approved ? "obsolete" : "rejected",
      waitKind: undefined,
      review: {
        required: true,
        status: input.approved ? "accepted" : "rejected",
        feedback: input.feedback,
        reviewedAt: input.reviewedAt,
      },
    };
    if (input.approved) {
      nextResults.push(reviewedResult);
    } else {
      nextResults.push(reviewedResult, {
        ...reviewedResult,
        id: `${result.id ?? `result_${input.nodeId}`}_review_rejected`,
        status: "current",
        waitKind: "review",
        error: input.feedback ?? "Approval rejected",
      });
    }
  }

  return {
    ...input.state,
    attempts: input.approved
      ? input.state.attempts.map((attempt) =>
          attempt.nodeId === input.nodeId && attempt.status === "succeeded"
            ? { ...attempt, status: "cancelled" }
            : attempt,
        )
      : input.state.attempts,
    results: nextResults,
  };
}

export function retryNodeState(input: {
  state: GraphExecutionState;
  nodeId: string;
  reason: string;
  finishedAt: string;
}): GraphExecutionState {
  return {
    ...input.state,
    attempts: input.state.attempts.map((attempt) =>
      attempt.nodeId === input.nodeId && attempt.status !== "cancelled"
        ? {
            ...attempt,
            status: "cancelled",
            finishedAt: input.finishedAt,
            error: { code: "RETRY_REQUESTED", message: input.reason },
          }
        : attempt,
    ),
    results: markNodeResults(input.state.results, input.nodeId, "obsolete"),
  };
}

export function cancelSessionState(input: {
  state: GraphExecutionState;
  reason: string;
  finishedAt: string;
}): GraphExecutionState {
  const runningNodeIds = new Set(
    input.state.attempts
      .filter((attempt) => attempt.status === "running")
      .flatMap((attempt) => attempt.nodeId ? [attempt.nodeId] : []),
  );

  return {
    ...input.state,
    graph: {
      ...input.state.graph,
      status: "cancelled",
      updatedAt: input.finishedAt,
    },
    attempts: input.state.attempts.map((attempt) =>
      attempt.status === "running"
        ? {
            ...attempt,
            status: "cancelled",
            finishedAt: input.finishedAt,
            error: { code: "EXECUTION_CANCELLED", message: input.reason },
          }
        : attempt,
    ),
    results: input.state.results.map((result) =>
      result.status === "current" && result.nodeId !== undefined && runningNodeIds.has(result.nodeId)
        ? { ...result, status: "obsolete" }
        : result,
    ),
  };
}

export function syncExternalResultState(input: {
  taskId: string;
  state: GraphExecutionState;
  externalResult: GraphExternalSyncResult;
  syncedAt: string;
}): GraphExecutionState {
  const effective = resolveEffectivePlanGraph(input.state);
  const node = effective.nodes.find(
    (candidate) => candidate.id === input.externalResult.nodeId,
  );
  const currentAttempt = [...input.state.attempts]
    .reverse()
    .find(
      (attempt) =>
        attempt.nodeId === input.externalResult.nodeId &&
        attempt.status === "running",
    );
  if (!currentAttempt) {
    const staleResult: NodeResult = {
      id: `result_${input.state.graph.id}_${input.externalResult.nodeId}_${input.syncedAt}_stale`,
      taskId: input.taskId,
      graphId: input.state.graph.id,
      nodeId: input.externalResult.nodeId,
      nodeLayerId: node?.activeLayerId ?? undefined,
      status: "stale",
      outputSummary: input.externalResult.status === "done" ? input.externalResult.summary : undefined,
      outputs: input.externalResult.status === "done" ? normalizeResultOutputs(input.externalResult.output) : undefined,
      error: input.externalResult.status === "failed"
        ? input.externalResult.error
        : input.externalResult.status === "cancelled" || input.externalResult.status === "blocked"
          ? input.externalResult.reason
          : undefined,
      evidence: normalizeResultEvidence(input.externalResult.evidence),
      selectedBranch: input.externalResult.status === "done" ? input.externalResult.selectedBranch : undefined,
    };
    return {
      ...input.state,
      results: [...input.state.results, staleResult],
    };
  }
  const baseResult = {
    id: `result_${input.state.graph.id}_${input.externalResult.nodeId}_${input.syncedAt}`,
    taskId: input.taskId,
    graphId: input.state.graph.id,
    nodeId: input.externalResult.nodeId,
    nodeLayerId: node?.activeLayerId ?? undefined,
    attemptId: currentAttempt.id,
  } satisfies NodeResult;
  const evidence = normalizeResultEvidence(input.externalResult.evidence);
  let syncedResult: NodeResult;
  let attemptStatus: NodeAttempt["status"] | null = null;
  let attemptError: NodeAttempt["error"] | undefined;

  switch (input.externalResult.status) {
    case "done":
      syncedResult = {
        ...baseResult,
        status: "current",
        outputSummary: input.externalResult.summary,
        outputs: normalizeResultOutputs(input.externalResult.output),
        evidence,
        selectedBranch: input.externalResult.selectedBranch,
      };
      attemptStatus = "succeeded";
      break;
    case "failed":
      syncedResult = {
        ...baseResult,
        status: "rejected",
        error: input.externalResult.error,
        evidence,
      };
      attemptStatus = "failed";
      attemptError = {
        code: "EXTERNAL_RESULT_FAILED",
        message: input.externalResult.error,
      };
      break;
    case "blocked":
      syncedResult = {
        ...baseResult,
        status: "current",
        waitKind: "manual_action",
        error: input.externalResult.reason,
        actionForm: input.externalResult.actionForm,
        evidence,
      };
      attemptStatus = "failed";
      attemptError = {
        code: "EXTERNAL_RESULT_BLOCKED",
        message: input.externalResult.reason,
      };
      break;
    case "cancelled":
      syncedResult = {
        ...baseResult,
        status: "rejected",
        error: input.externalResult.reason ?? "External work cancelled",
        evidence,
      };
      attemptStatus = "cancelled";
      attemptError = {
        code: "EXTERNAL_RESULT_CANCELLED",
        message: input.externalResult.reason ?? "External work cancelled",
      };
      break;
  }

  return {
    ...input.state,
    attempts:
      updateAttemptStatus({
        attempts: input.state.attempts,
        attemptId: currentAttempt.id,
        status: attemptStatus,
        finishedAt: input.syncedAt,
        error: attemptError,
      }),
    results: appendCurrentResult({
      results: input.state.results,
      result: syncedResult,
    }),
  };
}

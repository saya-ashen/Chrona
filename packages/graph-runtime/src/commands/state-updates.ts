import { appendCurrentResult, markNodeResults, updateAttemptStatus } from "../execution-state";
import { normalizeResultEvidence } from "../evidence";
import { resolveEffectivePlanGraph } from "../resolve";
import type { GraphExecutionState, GraphSubmittedNodeResult } from "../execution/types";
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

export function submitNodeResultState(input: {
  taskId: string;
  state: GraphExecutionState;
  nodeResult: GraphSubmittedNodeResult;
  submittedAt: string;
}): GraphExecutionState {
  const effective = resolveEffectivePlanGraph(input.state);
  const node = effective.nodes.find(
    (candidate) => candidate.id === input.nodeResult.nodeId,
  );
  const conditionMissingBranch =
    node?.type === "condition" &&
    input.nodeResult.status === "done" &&
    !input.nodeResult.selectedBranch;
  const currentResult = [...input.state.results]
    .reverse()
    .find(
      (result) =>
        result.nodeId === input.nodeResult.nodeId &&
        result.status === "current",
    );
  const currentAttempt = [...input.state.attempts]
    .reverse()
    .find(
      (attempt) =>
        attempt.nodeId === input.nodeResult.nodeId &&
        (
          attempt.status === "running" ||
          (currentResult?.attemptId === attempt.id && currentResult.waitKind)
        ),
    );
  if (!currentAttempt) {
    const staleResult: NodeResult = {
      id: `result_${input.state.graph.id}_${input.nodeResult.nodeId}_${input.submittedAt}_stale`,
      taskId: input.taskId,
      graphId: input.state.graph.id,
      nodeId: input.nodeResult.nodeId,
      nodeLayerId: node?.activeLayerId ?? undefined,
      status: "stale",
      outputSummary: input.nodeResult.status === "done" ? input.nodeResult.summary : undefined,
      outputs: input.nodeResult.status === "done" ? normalizeResultOutputs(input.nodeResult.output) : undefined,
      error: input.nodeResult.status === "failed"
        ? input.nodeResult.error
        : input.nodeResult.status === "cancelled" || input.nodeResult.status === "blocked"
          ? input.nodeResult.reason
          : undefined,
      evidence: normalizeResultEvidence(input.nodeResult.evidence),
      selectedBranch: input.nodeResult.status === "done" ? input.nodeResult.selectedBranch : undefined,
    };
    return {
      ...input.state,
      results: [...input.state.results, staleResult],
    };
  }
  const baseResult = {
    id: `result_${input.state.graph.id}_${input.nodeResult.nodeId}_${input.submittedAt}`,
    taskId: input.taskId,
    graphId: input.state.graph.id,
    nodeId: input.nodeResult.nodeId,
    nodeLayerId: node?.activeLayerId ?? undefined,
    attemptId: currentAttempt.id,
  } satisfies NodeResult;
  const evidence = normalizeResultEvidence(input.nodeResult.evidence);
  let syncedResult: NodeResult;
  let attemptStatus: NodeAttempt["status"] | null = null;
  let attemptError: NodeAttempt["error"] | undefined;

  switch (input.nodeResult.status) {
    case "done":
      if (conditionMissingBranch) {
        syncedResult = {
          ...baseResult,
          status: "current",
          waitKind: "manual_action",
          error: `Condition node ${input.nodeResult.nodeId} completed without a structured selectedBranch`,
          evidence,
        };
        attemptStatus = "failed";
        attemptError = {
          code: "CONDITION_BRANCH_MISSING",
          message: syncedResult.error ?? "Condition selectedBranch is required",
        };
      } else {
        syncedResult = {
          ...baseResult,
          status: "current",
          outputSummary: input.nodeResult.summary,
          outputs: normalizeResultOutputs(input.nodeResult.output),
          evidence,
          selectedBranch: input.nodeResult.selectedBranch,
        };
        attemptStatus = "succeeded";
      }
      break;
    case "failed":
      syncedResult = {
        ...baseResult,
        status: "rejected",
        error: input.nodeResult.error,
        evidence,
      };
      attemptStatus = "failed";
      attemptError = {
        code: "EXTERNAL_RESULT_FAILED",
        message: input.nodeResult.error,
      };
      break;
    case "blocked":
      syncedResult = {
        ...baseResult,
        status: "current",
        waitKind: "manual_action",
        error: input.nodeResult.reason,
        actionForm: input.nodeResult.actionForm,
        evidence,
      };
      attemptStatus = "failed";
      attemptError = {
        code: "EXTERNAL_RESULT_BLOCKED",
        message: input.nodeResult.reason,
      };
      break;
    case "cancelled":
      syncedResult = {
        ...baseResult,
        status: "rejected",
        error: input.nodeResult.reason ?? "External work cancelled",
        evidence,
      };
      attemptStatus = "cancelled";
      attemptError = {
        code: "EXTERNAL_RESULT_CANCELLED",
        message: input.nodeResult.reason ?? "External work cancelled",
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
        finishedAt: input.submittedAt,
        error: attemptError,
      }),
    results: appendCurrentResult({
      results: input.state.results,
      result: syncedResult,
    }),
  };
}

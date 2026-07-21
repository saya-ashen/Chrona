import type { GraphExecutionState } from "@chrona/graph-runtime";
import type { NodeAttempt, NodeResult } from "@chrona/contracts/ai";
import { getPlanRun } from "../persistence/plan-run-store";

function currentNodeResult(input: {
  results: NodeResult[];
  nodeId: string;
  attemptId?: string;
}) {
  return [...input.results].reverse().find(
    (result) =>
      result.nodeId === input.nodeId &&
      (!input.attemptId || result.attemptId === input.attemptId) &&
      (result.status === "current" || result.status === "rejected"),
  ) ?? null;
}

export async function committedStateIfNodeAdvanced(input: {
  taskId: string;
  planId: string;
  nodeId: string | null;
  attemptId?: string;
  results: NodeResult[];
  workBlockId?: string | null;
}) {
  if (!input.nodeId) return null;
  const localResult = currentNodeResult({ results: input.results, nodeId: input.nodeId, attemptId: input.attemptId });

  const committed = await getPlanRun(input.taskId, input.planId, input.workBlockId);
  if (!committed?.graph) return null;
  const committedResult = currentNodeResult({ results: committed.results, nodeId: input.nodeId, attemptId: input.attemptId });
  if (!committedResult || committedResult.id === localResult?.id) {
    return null;
  }

  return committed;
}

export async function committedStateForSubmittedNode(input: {
  taskId: string;
  planId: string;
  nodeId: string;
  attemptId: string;
  workBlockId?: string | null;
}) {
  const committed = await getPlanRun(input.taskId, input.planId, input.workBlockId);
  if (!committed?.graph) return null;
  const submittedResult = committed.results.find(
    (result) =>
      result.nodeId === input.nodeId &&
      result.attemptId === input.attemptId &&
      (result.status === "current" || result.status === "rejected"),
  );
  if (!submittedResult) {
    return null;
  }

  return committed;
}

export async function committedStateIfRunningNodeAdvanced(input: {
  taskId: string;
  planId: string;
  state: GraphExecutionState;
  workBlockId?: string | null;
}) {
  const runningAttempt = [...(input.state.attempts as unknown as NodeAttempt[])]
    .reverse()
    .find((attempt) => attempt.status === "running") ?? null;
  const runningNodeId = runningAttempt?.nodeId ?? null;

  return committedStateIfNodeAdvanced({
    taskId: input.taskId,
    planId: input.planId,
    nodeId: runningNodeId,
    attemptId: runningAttempt?.id,
    results: input.state.results as unknown as NodeResult[],
    workBlockId: input.workBlockId,
  });
}

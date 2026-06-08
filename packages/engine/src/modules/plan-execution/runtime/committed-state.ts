import type { GraphExecutionState } from "@chrona/graph-runtime";
import type { NodeAttempt, NodeResult } from "@chrona/contracts/ai";
import { getPlanRun } from "../persistence/plan-run-store";

function hasCurrentNodeResult(input: {
  results: NodeResult[];
  nodeId: string;
}) {
  return input.results.some(
    (result) =>
      result.nodeId === input.nodeId &&
      (result.status === "current" || result.status === "rejected"),
  );
}

export async function committedStateIfNodeAdvanced(input: {
  taskId: string;
  planId: string;
  nodeId: string | null;
  results: NodeResult[];
  workBlockId?: string | null;
}) {
  if (!input.nodeId || hasCurrentNodeResult({ results: input.results, nodeId: input.nodeId })) {
    return null;
  }

  const committed = await getPlanRun(input.taskId, input.planId, input.workBlockId);
  if (!committed?.graph) return null;
  if (!hasCurrentNodeResult({ results: committed.results, nodeId: input.nodeId })) {
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
  const runningNodeId = [...(input.state.attempts as unknown as NodeAttempt[])]
    .reverse()
    .find((attempt) => attempt.status === "running")?.nodeId ?? null;

  return committedStateIfNodeAdvanced({
    taskId: input.taskId,
    planId: input.planId,
    nodeId: runningNodeId,
    results: input.state.results as unknown as NodeResult[],
    workBlockId: input.workBlockId,
  });
}

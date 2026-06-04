import type { ExecutionActionInput, NodeResult, NodeResultOutput, PlanExecutionResult } from "@chrona/contracts/ai";
import { getAcceptedCompiledPlanForTask } from "../persistence/execution-scope";
import { getCurrentExecution } from "./get-current-execution";
import { getPlanRun, savePlanRun } from "../plan-run-store";
import { appendMainSessionEvent, ensurePlanMainSession } from "../plan-state-store";
import { toEffectivePlanGraph } from "../projection/execution-graph-selectors";
import type { ExecutionDispatchContext } from "../types";
import type { ExecutionActionWithContinuation } from "../types";
import { dispatchExecutionAction } from "../task-plan-execution";

function asOutputs(value: unknown): NodeResultOutput[] {
  return Array.isArray(value) ? value as NodeResultOutput[] : [];
}

function outputNodeFromEffective(input: {
  effective: ReturnType<typeof toEffectivePlanGraph>;
  nodeId?: string;
}) {
  if (input.nodeId) {
    const node = input.effective.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!node) throw new Error("nodeId does not resolve to a node in the current execution graph");
    return node;
  }
  const node = input.effective.nodes.find((candidate) => candidate.status === "running")
    ?? input.effective.nodes.find((candidate) => input.effective.readyNodeIds.includes(candidate.id));
  if (!node) throw new Error("No active node is available for output submission");
  return node;
}

async function submitNodeOutput(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, { action: "submit_node_output" }>;
}): Promise<PlanExecutionResult> {
  const accepted = await getAcceptedCompiledPlanForTask(input.taskId, {
    sessionId: input.action.sessionId,
  });
  if (!accepted) throw new Error("No accepted plan. Create or accept a plan before submitting node output.");
  const persisted = await getPlanRun(input.taskId, accepted.compiledPlan.editablePlanId, accepted.workBlockId);
  if (!persisted?.graph) throw new Error("No runtime graph is available for output submission");
  const effective = toEffectivePlanGraph({
    graph: persisted.graph,
    attempts: persisted.attempts,
    results: persisted.results,
  });
  const node = outputNodeFromEffective({ effective, nodeId: input.action.nodeId });
  const prior = persisted.results.findLast((result) => result.nodeId === node.id && result.status === "current");
  const priorOutputs = input.action.mode === "replace" ? [] : prior?.outputs ?? [];
  const nextResult: NodeResult = {
    ...(prior ?? {}),
    id: prior?.id ?? `result_${persisted.graph.id}_${node.id}_${Date.now()}`,
    taskId: input.taskId,
    graphId: persisted.graph.id,
    nodeId: node.id,
    nodeLayerId: node.activeLayerId ?? prior?.nodeLayerId,
    attemptId: prior?.attemptId,
    status: "current",
    outputSummary: input.action.summary ?? prior?.outputSummary,
    outputs: [...priorOutputs, ...asOutputs(input.action.outputs)],
    evidence: {
      ...prior?.evidence,
      sessionId: input.action.sessionId ?? prior?.evidence?.sessionId,
    },
  };
  const results = prior
    ? persisted.results.map((result) => result === prior ? nextResult : result)
    : [...persisted.results, nextResult];
  await savePlanRun({
    workspaceId: accepted.workspaceId,
    taskId: input.taskId,
    planId: accepted.compiledPlan.editablePlanId,
    workBlockId: accepted.workBlockId,
    run: persisted.planRun,
    compiledPlan: accepted.compiledPlan,
    graph: persisted.graph,
    attempts: persisted.attempts,
    results,
    executionContextSnapshots: persisted.executionContextSnapshots,
  });
  const mainSession = input.action.sessionId
    ? { id: input.action.sessionId }
    : await ensurePlanMainSession({ taskId: input.taskId, planId: accepted.compiledPlan.editablePlanId });
  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: accepted.compiledPlan.editablePlanId,
    sessionId: mainSession.id,
    eventType: "node_result_submitted",
    payload: {
      nodeId: node.id,
      outputCount: asOutputs(input.action.outputs).length,
      mode: input.action.mode ?? "append",
    },
  });
  return getCurrentExecution({ taskId: input.taskId, workBlockId: accepted.workBlockId });
}

/**
 * Terminal node submission. submit_node_output appends partial outputs to the
 * running node; the terminal kinds (complete/block/fail) flow through the
 * kernel via dispatchExecutionAction, which continues serially to the next
 * ready node within the same dispatch — no out-of-band setTimeout follow-up.
 */
export async function submitTerminalNodeResult(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, {
    action: "submit_node_output" | "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {
  if (input.action.action === "submit_node_output") {
    return submitNodeOutput(input as {
      taskId: string;
      commandContext?: ExecutionDispatchContext;
      action: Extract<ExecutionActionInput, { action: "submit_node_output" }>;
    });
  }

  return dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action.action === "complete_manual_node"
      ? ({ ...input.action, continueExecution: false } satisfies ExecutionActionWithContinuation)
      : input.action,
    commandContext: input.commandContext,
  });
}

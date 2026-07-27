import { resolveEffectivePlanGraph } from "../resolve";
import { runGraphExecution } from "../execution/run-graph-execution";
import { approveCurrentNodeResult } from "./state-updates";
import type { GraphExecutionCallbacks, GraphExecutionEvent } from "../execution/types";
import type { GraphDispatchOutcome, GraphRuntimeCommand, GraphRuntimeOptions } from "./types";

export async function approveCurrentNodeCommand<TContext>(input: {
  command: Extract<GraphRuntimeCommand, { type: "resume_with_approval" }>;
  options: GraphRuntimeOptions<TContext>;
  callbacks: GraphExecutionCallbacks<TContext>;
  events: GraphExecutionEvent[];
}): Promise<GraphDispatchOutcome> {
  const reviewedAt = new Date(
    input.options.now?.() ?? Date.now(),
  ).toISOString();
  const approvedState = approveCurrentNodeResult({
    state: input.command.state,
    nodeId: input.command.input.nodeId,
    approved: input.command.input.approved,
    feedback: input.command.input.feedback,
    reviewedAt,
  });
  if (!input.command.input.approved) {
    const effective = resolveEffectivePlanGraph(approvedState);
    return {
      status: "waiting_for_approval",
      currentNodeId: input.command.input.nodeId,
      executedNodeIds: [],
      effective,
      state: approvedState,
      events: input.events,
      waitKind: "review",
      message: input.command.input.feedback ?? "Approval rejected",
    };
  }
  const effective = resolveEffectivePlanGraph(approvedState);
  const approvedNode = effective.nodes.find((node) => node.id === input.command.input.nodeId);
  if (approvedNode?.status === "completed" && approvedNode.type === "task") {
    return {
      status: "completed",
      currentNodeId: null,
      executedNodeIds: [input.command.input.nodeId],
      effective,
      state: approvedState,
      events: input.events,
      message: "Approval accepted",
    };
  }

  const outcome = await runGraphExecution({
    taskId: input.options.taskId,
    runtimeName: input.options.runtimeName,
    trigger: input.command.trigger ?? "manual",
    state: approvedState,
    context: input.command.context as TContext,
    maxSteps: input.options.policies?.maxSteps,
    maxConcurrency: input.options.policies?.maxConcurrency,
    forcedNodeId: approvedNode?.status === "completed" ? undefined : input.command.input.nodeId,
    userInput: input.command.input.userInput,
    now: input.options.now,
    callbacks: input.callbacks,
  });
  return {
    ...outcome,
    executedNodeIds: [input.command.input.nodeId, ...outcome.executedNodeIds],
    events: input.events,
  };
}

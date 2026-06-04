import { createLogger } from "@chrona/shared/logger";
import type { ExecutionActionInput, NodeResult, NodeResultOutput, PlanExecutionResult } from "@chrona/contracts/ai";
import { db } from "@/lib/db";
import { getAcceptedCompiledPlan } from "../compiled-plan-store";
import { getCurrentExecution } from "./get-current-execution";
import { getPlanRun, savePlanRun } from "../plan-run-store";
import { appendMainSessionEvent, ensurePlanMainSession } from "../plan-state-store";
import { toEffectivePlanGraph } from "../projection/execution-graph-selectors";
import type { ExecutionDispatchContext } from "../types";
import {
  continuePlanExecution,
  dispatchExecutionAction,
} from "../task-plan-execution";

const logger = createLogger("engine.plan-execution");

async function canContinueTerminalResult(input: {
  taskId: string;
  sessionId?: string;
}) {
  const session = await db.executionSession.findFirst({
    where: { taskId: input.taskId, status: "Active" },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (!session) {
    return { canContinue: false, reason: "no_active_execution_session" };
  }

  const accepted = await getAcceptedCompiledPlan(input.taskId);
  if (!accepted) {
    return { canContinue: false, reason: "no_accepted_plan" };
  }

  const persisted = await getPlanRun(input.taskId, accepted.compiledPlan.editablePlanId, accepted.workBlockId);
  if (!persisted?.graph) {
      return {
        canContinue: false,
        planId: accepted.compiledPlan.editablePlanId,
        workBlockId: accepted.workBlockId,
        reason: "no_runtime_graph",
    };
  }

  const effective = toEffectivePlanGraph({
    graph: persisted.graph,
    attempts: persisted.attempts,
    results: persisted.results,
  });

  if (!effective.nodes.some((node) => node.ready)) {
      return {
        canContinue: false,
        planId: accepted.compiledPlan.editablePlanId,
        workBlockId: accepted.workBlockId,
        reason: "no_ready_node",
    };
  }

  return {
    canContinue: true,
    planId: accepted.compiledPlan.editablePlanId,
    workBlockId: accepted.workBlockId,
  };
}

async function appendContinuationSkippedEvent(input: {
  taskId: string;
  sessionId?: string;
  planId?: string;
  reason: string;
}) {
  if (!input.planId) return;
  const session = await db.executionSession.findFirst({
    where: { taskId: input.taskId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!session) return;
  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: input.planId,
    sessionId: session.id,
    eventType: "continuation_skipped",
    payload: {
      reason: input.reason,
      submittedSessionId: input.sessionId ?? null,
    },
  });
}

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
  const accepted = await getAcceptedCompiledPlan(input.taskId);
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

  const result = await dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action.action === "complete_manual_node"
      ? { ...input.action, continueExecution: false }
      : input.action,
    commandContext: input.commandContext,
  });

  if (input.action.action === "complete_manual_node" && result.status === "running") {
    const sessionId = input.action.sessionId;
    setTimeout(() => {
      void canContinueTerminalResult({ taskId: input.taskId, sessionId })
        .then(async (continuation) => {
          if (!continuation.canContinue) {
            return appendContinuationSkippedEvent({
              taskId: input.taskId,
              sessionId,
              planId: continuation.planId,
              reason: continuation.reason ?? "unknown",
            });
          }
          await continuePlanExecution({
            taskId: input.taskId,
            reason: "terminal_result_continuation",
            sessionId,
            resumeReadyNode: true,
            workBlockId: continuation.workBlockId,
          });
        })
        .catch((cause: unknown) => {
          logger.error("terminal_result.continuation_failed", {
            taskId: input.taskId,
            sessionId: sessionId ?? null,
            message: cause instanceof Error ? cause.message : String(cause),
          });
        });
    });
  }

  return result;
}

import { createLogger } from "@chrona/shared/logger";
import type { ExecutionActionInput, PlanExecutionResult } from "@chrona/contracts/ai";
import { db } from "@/lib/db";
import { getAcceptedCompiledPlan } from "../compiled-plan-store";
import { getPlanRun } from "../plan-run-store";
import { appendMainSessionEvent } from "../plan-state-store";
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

  const persisted = await getPlanRun(input.taskId, accepted.compiledPlan.editablePlanId);
  if (!persisted?.graph) {
    return {
      canContinue: false,
      planId: accepted.compiledPlan.editablePlanId,
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
      reason: "no_ready_node",
    };
  }

  return {
    canContinue: true,
    planId: accepted.compiledPlan.editablePlanId,
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

export async function submitTerminalNodeResult(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, {
    action: "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {
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

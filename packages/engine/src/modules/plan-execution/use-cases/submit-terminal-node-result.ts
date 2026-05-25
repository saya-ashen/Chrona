import { createLogger } from "@chrona/shared/logger";
import type { ExecutionActionInput, PlanExecutionResult } from "@chrona/contracts/ai";
import { db } from "@/lib/db";
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
    where: input.sessionId
      ? {
          taskId: input.taskId,
          status: "Active",
          OR: [{ id: input.sessionId }, { currentNodeId: { not: null } }],
        }
      : { taskId: input.taskId, status: "Active" },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return session?.status === "Active";
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
        .then((canContinue) => {
          if (!canContinue) return;
          return continuePlanExecution({
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

import { createLogger } from "@chrona/shared/logger";
import type { ExecutionActionInput, PlanExecutionResult } from "@chrona/contracts/ai";
import {
  continuePlanExecution,
  dispatchExecutionAction,
} from "../task-plan-execution";

const logger = createLogger("engine.plan-execution");

export async function submitTerminalNodeResult(input: {
  taskId: string;
  action: Extract<ExecutionActionInput, {
    action: "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {
  const result = await dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action.action === "complete_manual_node"
      ? { ...input.action, continueExecution: false }
      : input.action,
  });

  if (input.action.action === "complete_manual_node" && result.status === "running") {
    const sessionId = input.action.sessionId;
    queueMicrotask(() => {
      void continuePlanExecution({
        taskId: input.taskId,
        reason: "terminal_result_continuation",
        sessionId,
        resumeReadyNode: true,
      }).catch((cause: unknown) => {
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

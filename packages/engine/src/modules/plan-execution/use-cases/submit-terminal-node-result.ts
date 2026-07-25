import type { ExecutionActionInput, PlanExecutionResult } from "@chrona/contracts/ai";
import type { ExecutionDispatchContext, ExecutionActionWithContinuation } from "../types";
import { dispatchExecutionAction } from "../task-plan-execution";


/**
 * Terminal node submission. Semantic contributions and deliverable declarations
 * flow through the execution kernel and are persisted with the node result.
 */
export async function submitTerminalNodeResult(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, {
    action: "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {

  return dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action.action === "complete_manual_node"
      ? ({ ...input.action, continueExecution: false } satisfies ExecutionActionWithContinuation)
      : input.action,
    commandContext: input.commandContext,
  });
}

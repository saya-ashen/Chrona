import type { ExecutionActionInput, ExecutionCommand, ExecutionCommandContext, PlanExecutionResult } from "@chrona/contracts/ai";
import type { SubmittedNodeResult } from "@chrona/contracts/plan-runtime/execution-command";
import type { ExecutionDispatchContext, ExecutionActionWithContinuation } from "../types";
import { executeCommand } from "../kernel/execute-command";


/**
 * Terminal node submission. Semantic contributions and deliverable declarations
 * flow through the execution kernel and are persisted with the node result.
 */
function terminalResultCommand(action: ExecutionActionWithContinuation): {
  command: ExecutionCommand;
  context: ExecutionCommandContext;
} {
  const context: ExecutionCommandContext = {
    sessionId: "sessionId" in action ? action.sessionId : undefined,
    workBlockId: "workBlockId" in action ? action.workBlockId ?? null : null,
  };
  switch (action.action) {
    case "complete_manual_node": {
      const result: SubmittedNodeResult = {
        kind: "done",
        summary: action.summary,
        output: action.output,
        evidence: action.sessionId ? { sessionId: action.sessionId } : undefined,
        selectedBranch: action.selectedBranch,
        branchRef: action.branchRef,
        deliverables: action.deliverables,
        findings: action.findings,
        decisions: action.decisions,
        caveats: action.caveats,
        nextActions: action.nextActions,
        resultEvidence: action.evidenceItems?.map((item) => ({ ...item, sourceNodeRef: "" })),
      };
      return {
        command: { type: "submit_node_result", nodeId: action.nodeId, result, continueExecution: action.continueExecution ?? true },
        context,
      };
    }
    case "block_current_node":
      return { command: { type: "block_node", nodeId: action.nodeId, reason: action.reason, actionForm: action.actionForm }, context };
    case "fail_current_node":
      return { command: { type: "fail_node", nodeId: action.nodeId, error: action.error }, context };
    default:
      throw new Error(`Unsupported terminal action: ${JSON.stringify(action)}`);
  }
}

export async function submitTerminalNodeResult(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: Extract<ExecutionActionInput, {
    action: "complete_manual_node" | "block_current_node" | "fail_current_node";
  }>;
}): Promise<PlanExecutionResult> {

  const action: ExecutionActionWithContinuation = input.action.action === "complete_manual_node"
    ? { ...input.action, continueExecution: false }
    : input.action;
  const { command, context } = terminalResultCommand(action);
  return executeCommand({
    taskId: input.taskId,
    command,
    context: { ...context, actor: input.commandContext?.actor, origin: input.commandContext?.origin },
  });
}

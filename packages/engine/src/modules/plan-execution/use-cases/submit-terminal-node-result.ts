/* eslint-disable complexity -- Terminal submission explicitly distinguishes every authoritative action outcome. */
import type { ExecutionCommand, ExecutionCommandContext, PlanExecutionResult } from "@chrona/contracts/ai";
import type { SubmittedNodeResult } from "@chrona/contracts/plan-runtime/execution-command";
import type { ExecutionDispatchContext, SubmitNodeResultAction } from "../types";
import { executeCommand } from "../kernel/execute-command";
import type { SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";


/**
 * Terminal node submission. Semantic contributions and deliverable declarations
 * flow through the execution kernel and are persisted with the node result.
 */
function terminalResultCommand(action: SubmitNodeResultAction, sessionId?: string | null): {
  command: ExecutionCommand;
  context: ExecutionCommandContext;
} {
  const context: ExecutionCommandContext = {
    ...(sessionId ? { sessionId } : {}),
  };
  const identity = {
    expectedAttemptId: "expectedAttemptId" in action ? action.expectedAttemptId : undefined,
    runtimeRunRef: "runtimeRunRef" in action ? action.runtimeRunRef : undefined,
    providerRunId: "providerRunId" in action ? action.providerRunId : undefined,
  };
  switch (action.action) {
    case "complete_manual_node": {
      const result: SubmittedNodeResult = {
        kind: "done",
        summary: action.summary,
        output: action.output,
        inputFields: action.inputFields,
        evidence: sessionId ? { sessionId } : undefined,
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
        command: { type: "submit_node_result", nodeId: action.nodeId, result, continueExecution: action.continueExecution ?? true, ...identity },
        context,
      };
    }
    case "block_current_node":
      return { command: { type: "submit_node_result", nodeId: action.nodeId, result: { kind: "blocked", reason: action.reason, actionForm: action.actionForm }, ...identity }, context };
    case "fail_current_node":
      return { command: { type: "submit_node_result", nodeId: action.nodeId, result: { kind: "failed", error: action.error }, ...identity }, context };
    default:
      throw new Error(`Unsupported terminal action: ${JSON.stringify(action)}`);
  }
}

export async function submitTerminalNodeResult(input: {
  taskId: string;
  commandContext?: ExecutionDispatchContext;
  action: SubmitNodeResultAction;
  workContext?: SchedulerWorkContext;
}): Promise<PlanExecutionResult> {
  const { command: terminalCommand, context } = terminalResultCommand(input.action, input.commandContext?.sessionId);
  if (terminalCommand.type !== "submit_node_result") {
    throw new Error("Terminal action did not produce a node result command");
  }
  const contextAttemptId = input.commandContext?.nodeAttemptId ?? undefined;
  const contextProviderRunId = input.commandContext?.providerRunId ?? undefined;
  if (terminalCommand.expectedAttemptId && contextAttemptId && terminalCommand.expectedAttemptId !== contextAttemptId) {
    throw new Error("Terminal action attempt identity does not match its durable command scope");
  }
  if (terminalCommand.providerRunId && contextProviderRunId && terminalCommand.providerRunId !== contextProviderRunId) {
    throw new Error("Terminal action provider run identity does not match its durable command scope");
  }
  const command: ExecutionCommand = {
    ...terminalCommand,
    expectedAttemptId: terminalCommand.expectedAttemptId ?? contextAttemptId,
    runtimeRunRef: terminalCommand.runtimeRunRef ?? input.commandContext?.runtimeRunRef ?? undefined,
    providerRunId: terminalCommand.providerRunId ?? contextProviderRunId,
  };
  return executeCommand({
    taskId: input.taskId,
    command,
    context: {
      ...context,
      sessionId: context.sessionId ?? input.commandContext?.sessionId ?? undefined,
      idempotencyKey: input.commandContext?.idempotencyKey ?? undefined,
      runId: input.commandContext?.runId,
      nodeAttemptId: contextAttemptId,
      providerRunId: contextProviderRunId,
      actor: input.commandContext?.actor,
      origin: input.commandContext?.origin,
    },
    workContext: input.workContext,
  });
}

import type { PlanExecutionResult } from "@chrona/contracts/ai";
import type {
  AdvanceRuntimeCommand,
  ExecutionActionWithContinuation,
  OrchestratorTrigger,
  PlanExecutionObserver,
} from "../types";
import { ensurePlanMainSession } from "../plan-state-store";
import { ensureExecutionSession } from "../persistence/execution-session-store";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";

type AdvancePlanExecution = (input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  mainSession: { id: string; taskId: string; sessionKey: string };
  executionSession: Awaited<ReturnType<typeof ensureExecutionSession>>;
  command: AdvanceRuntimeCommand;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

type RuntimeCommandAction = Extract<
  ExecutionActionWithContinuation,
  | { action: "complete_manual_node" }
  | { action: "block_current_node" }
  | { action: "fail_current_node" }
  | { action: "retry_node" }
  | { action: "cancel_session" }
>;

function noPlanResponse(input: {
  taskId: string;
  mainSessionId?: string | null;
}): PlanExecutionResult {
  return {
    taskId: input.taskId,
    planId: null,
    mainSessionId: input.mainSessionId ?? null,
    status: "no_plan",
    currentNodeId: null,
    executedNodeIds: [],
    waitingNodeIds: [],
    blockedNodeIds: [],
    checkpoint: null,
    message: "No accepted plan. Create or accept a plan before execution.",
  };
}

function commandForAction(action: RuntimeCommandAction): AdvanceRuntimeCommand {
  switch (action.action) {
    case "complete_manual_node":
      return {
        type: "complete_manual_node",
        nodeId: action.nodeId,
        summary: action.summary,
        output: action.output,
        selectedBranch: action.selectedBranch,
        terminalKind: action.terminalKind,
        branchRef: action.branchRef,
        decision: action.decision,
        feedback: action.feedback,
        prompt: action.prompt,
        continueExecution: action.continueExecution,
      };
    case "block_current_node":
      return {
        type: "block_current_node",
        nodeId: action.nodeId,
        reason: action.reason,
        actionForm: action.actionForm,
      };
    case "fail_current_node":
      return {
        type: "fail_current_node",
        nodeId: action.nodeId,
        error: action.error,
      };
    case "retry_node":
      return {
        type: "retry_node",
        nodeId: action.nodeId,
        reason: action.prompt ?? "Node retry requested",
        userInput: action.prompt,
      };
    case "cancel_session":
      return {
        type: "cancel_session",
        reason: action.reason ?? "Execution cancelled",
      };
  }
}

export async function dispatchRuntimeCommandAction(input: {
  taskId: string;
  action: RuntimeCommandAction;
  advance: AdvancePlanExecution;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return noPlanResponse({
      taskId: input.taskId,
      mainSessionId: input.action.sessionId ?? null,
    });
  }

  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: "manual",
    sessionId: input.action.sessionId,
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  return input.advance({
    taskId: input.taskId,
    trigger: "manual",
    mainSession,
    executionSession,
    command: commandForAction(input.action),
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

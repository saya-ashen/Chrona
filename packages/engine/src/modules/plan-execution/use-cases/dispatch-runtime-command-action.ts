import type { PlanExecutionResult } from "@chrona/contracts/ai";
import type {
  AdvanceRuntimeCommand,
  ExecutionActionWithContinuation,
  OrchestratorTrigger,
  PlanGraphCommandActor,
  PlanGraphCommandEnvelope,
  PlanGraphCommandOrigin,
  PlanExecutionControl,
  PlanExecutionObserver,
} from "../types";
import type { ExecutionLeaseScope } from "../persistence/execution-lease-store";
import { ensurePlanMainSession } from "../plan-state-store";
import { ensureExecutionSession } from "../persistence/execution-session-store";
import { ensureNativePlanRun } from "../persistence/plan-runtime-store";
import { buildPlanGraphCommandEnvelope } from "../runtime/command-envelope";

type AdvancePlanExecution = (input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  mainSession: { id: string; taskId: string; sessionKey: string };
  executionSession: Awaited<ReturnType<typeof ensureExecutionSession>>;
  envelope: PlanGraphCommandEnvelope;
  control?: PlanExecutionControl;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

type LeaseAdvance = (input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  ownerId: string;
  scope: ExecutionLeaseScope;
  run: () => Promise<PlanExecutionResult>;
}) => Promise<PlanExecutionResult>;

type RuntimeCommandAction = Extract<
  ExecutionActionWithContinuation,
  | { action: "complete_manual_node" }
  | { action: "block_current_node" }
  | { action: "fail_current_node" }
  | { action: "retry_node" }
  | { action: "pause_session" }
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
    case "pause_session":
      return {
        type: "pause_session",
        reason: action.reason ?? "Execution paused",
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
  actor?: PlanGraphCommandActor;
  origin?: PlanGraphCommandOrigin;
  toolInvocationId?: string | null;
  providerRunId?: string | null;
  causationEventId?: string | null;
  causationRawEventId?: string | null;
  advance: AdvancePlanExecution;
  withExecutionLease?: LeaseAdvance;
  control?: PlanExecutionControl;
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

  const command = commandForAction(input.action);
  const run = () => input.advance({
    taskId: input.taskId,
    trigger: "manual",
    mainSession,
    executionSession,
    envelope: buildPlanGraphCommandEnvelope({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: mainSession.id,
      executionSessionId: executionSession.id,
      command,
      trigger: "manual",
      actor: input.actor,
      origin: input.origin,
      toolInvocationId: input.toolInvocationId,
      providerRunId: input.providerRunId,
      causationEventId: input.causationEventId,
      causationRawEventId: input.causationRawEventId,
    }),
    control: input.control,
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });

  if (!input.withExecutionLease) {
    return run();
  }

  return input.withExecutionLease({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    ownerId: executionSession.id,
    scope: "manual",
    run,
  });
}

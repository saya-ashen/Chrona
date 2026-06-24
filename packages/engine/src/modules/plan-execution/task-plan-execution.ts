import { db } from "@/lib/db";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { executionStatusFromEffectiveGraph } from "./execution-state-machine";
import { deriveExecutionCheckpoint } from "./execution-checkpoint";
import { resolveCheckpointAction } from "./execution-actions";
import type {
  EffectivePlanGraph,
  ExecutionCommand,
  ExecutionCommandContext,
  ExecutionTrigger,
  PlanExecutionResult,
  PlanExecutionStatus,
  SubmitCheckpointActionInput,
  SubmitCheckpointActionResult,
  WaitKind,
} from "@chrona/contracts/ai";
import type {
  ExecutionActionWithContinuation,
  ExecutionDispatchContext,
  OrchestratorTrigger,
  PlanExecutionObserver,
} from "./types";
import { ensureNativePlanRun } from "./persistence/plan-runtime-store";
import { ensurePlanMainSession } from "./persistence/plan-state-store";
import { currentNodeFromEffective } from "./projection/execution-graph-selectors";
import { executeCommand } from "./kernel/execute-command";
import { resolveCheckpointTransition } from "./use-cases/checkpoint-transition/resolve-checkpoint-transition";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export { getCurrentExecution } from "./use-cases/get-current-execution";
export { submitTerminalNodeResult } from "./use-cases/submit-terminal-node-result";
export { syncPlanRunRuntimeResult } from "./kernel/sync-runtime-result";
export { reconcileStaleRuntimeRuns } from "./use-cases/sync-runtime-result/reconcile-stale-runtime-runs";

function mapTerminalReasonToStatus(effective: EffectivePlanGraph): PlanExecutionStatus {
  return executionStatusFromEffectiveGraph(effective);
}

// ───────────────────────────────────────────────────────────────────────────
// Public entry points. Each translates its legacy input shape into one
// ExecutionCommand and dispatches it through the single-writer kernel. They
// keep their original signatures so existing callers and the facade are
// unaffected.
// ───────────────────────────────────────────────────────────────────────────

export async function startPlanExecution(
  input: {
    taskId: string;
    trigger: OrchestratorTrigger;
    prompt?: string;
    workBlockId?: string | null;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  return executeCommand({
    taskId: input.taskId,
    command: { type: "start", trigger: input.trigger, prompt: input.prompt },
    context: { trigger: input.trigger, workBlockId: input.workBlockId ?? null },
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

export async function continuePlanExecution(
  input: {
    taskId: string;
    reason: string;
    userInput?: string;
    inputFields?: Record<string, string>;
    sessionId?: string;
    nodeId?: string;
    resumeReadyNode?: boolean;
    workBlockId?: string | null;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  const command: ExecutionCommand =
    input.inputFields && Object.keys(input.inputFields).length > 0
      ? { type: "resume_with_input", nodeId: input.nodeId, inputFields: input.inputFields }
      : { type: "resume_after_unblock", nodeId: input.nodeId, note: input.userInput };
  return executeCommand({
    taskId: input.taskId,
    command,
    context: { sessionId: input.sessionId, workBlockId: input.workBlockId ?? null },
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

export async function resumePlanExecutionWithApproval(
  input: {
    taskId: string;
    sessionId?: string;
    nodeId?: string;
    workBlockId?: string | null;
    approved: boolean;
    feedback?: string;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  return executeCommand({
    taskId: input.taskId,
    command: {
      type: "resume_with_approval",
      nodeId: input.nodeId,
      approved: input.approved,
      feedback: input.feedback,
    },
    context: { sessionId: input.sessionId, workBlockId: input.workBlockId ?? null },
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

function commandForExecutionAction(
  action: ExecutionActionWithContinuation,
): { command: ExecutionCommand; context: ExecutionCommandContext } {
  const sessionId = "sessionId" in action ? action.sessionId : undefined;
  const workBlockId = "workBlockId" in action ? action.workBlockId ?? null : null;
  const context: ExecutionCommandContext = { sessionId, workBlockId };

  switch (action.action) {
    case "start_manual":
      return {
        command: { type: "start", trigger: "manual", prompt: action.prompt },
        context: { ...context, trigger: "manual" },
      };
    case "start_scheduled":
      return {
        command: { type: "start", trigger: "scheduler" },
        context: { ...context, trigger: "scheduler" },
      };
    case "resume_with_input":
      return {
        command: { type: "resume_with_input", nodeId: action.nodeId, inputFields: action.inputFields },
        context,
      };
    case "resume_with_approval":
      return {
        command: {
          type: "resume_with_approval",
          nodeId: action.nodeId,
          approved: action.decision === "approve",
          feedback: action.feedback ?? action.editedContent,
        },
        context,
      };
    case "resume_after_unblock":
      return {
        command: { type: "resume_after_unblock", nodeId: action.nodeId, note: action.note },
        context,
      };
    case "update_plan_output":
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "update_plan_output must be handled through plan output submission",
      );
    case "complete_manual_node":
      return {
        command: {
          type: "submit_node_result",
          nodeId: action.nodeId,
          result: {
            kind: "done",
            summary: action.summary,
            output: action.output,
            evidence: action.sessionId ? { sessionId: action.sessionId } : undefined,
            selectedBranch: action.selectedBranch,
            branchRef: action.branchRef,
          },
          continueExecution: action.continueExecution ?? true,
        },
        context,
      };
    case "block_current_node":
      return {
        command: {
          type: "block_node",
          nodeId: action.nodeId,
          reason: action.reason,
          actionForm: action.actionForm,
        },
        context,
      };
    case "fail_current_node":
      return {
        command: { type: "fail_node", nodeId: action.nodeId, error: action.error },
        context,
      };
    case "retry_node":
      return {
        command: {
          type: "retry_node",
          nodeId: action.nodeId,
          reason: action.prompt ?? "Node retry requested",
          userInput: action.prompt,
        },
        context,
      };
    case "pause_session":
      return { command: { type: "pause", reason: action.reason }, context };
    case "cancel_session":
      return { command: { type: "cancel", reason: action.reason }, context };
    default: {
      const exhaustiveCheck: never = action;
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        `Unsupported execution action: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

export async function dispatchExecutionAction(
  input: {
    taskId: string;
    action: ExecutionActionWithContinuation;
    commandContext?: ExecutionDispatchContext;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  const { command, context } = commandForExecutionAction(input.action);
  return executeCommand({
    taskId: input.taskId,
    command,
    context: {
      ...context,
      actor: input.commandContext?.actor,
      origin: input.commandContext?.origin,
    },
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

export async function submitCheckpointAction(
  input: {
    taskId: string;
    action: SubmitCheckpointActionInput;
  } & PlanExecutionObserver,
): Promise<SubmitCheckpointActionResult> {
  const runtime = await ensureNativePlanRun(input.taskId, input.action.workBlockId ?? null);
  if (!runtime) {
    return {
      transition: { type: "stay_paused", reason: "No accepted plan." },
      execution: {
        taskId: input.taskId,
        planId: null,
        mainSessionId: null,
        status: "no_plan",
        currentNodeId: null,
        executedNodeIds: [],
        waitingNodeIds: [],
        blockedNodeIds: [],
        checkpoint: null,
        message: "No accepted plan. Create or accept a plan before execution.",
      },
    };
  }

  const executionSession = await db.executionSession.findFirst({
    where: {
      taskId: input.taskId,
      planId: runtime.planId,
      status: { in: ["Active", "Paused"] },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  if (!executionSession) {
    throw new Error("No active execution session found for checkpoint action.");
  }

  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });
  const effective = resolveEffectivePlanGraph({
    graph: runtime.persisted.graph!,
    attempts: runtime.persisted.attempts,
    results: runtime.persisted.results,
  });
  const status = mapTerminalReasonToStatus(effective);
  const currentNodeId =
    currentNodeFromEffective(effective)?.id ?? executionSession.currentNodeId;
  const checkpoint = deriveExecutionCheckpoint({
    taskId: input.taskId,
    sessionId: executionSession.id,
    planRunId: runtime.planId,
    status,
    effective,
    currentNodeId,
    waitKind: executionSession.pauseReason as WaitKind | undefined,
    message: "Execution checkpoint awaiting action.",
  });

  if (!checkpoint || checkpoint.id !== input.action.checkpointId) {
    throw new Error("Checkpoint is no longer active.");
  }

  const transition = resolveCheckpointAction({
    checkpoint,
    action: input.action.action,
    payload: input.action.payload,
  });

  return resolveCheckpointTransition({
    taskId: input.taskId,
    planId: runtime.planId,
    mainSession,
    executionSession,
    checkpoint,
    transition,
    action: input.action.action,
    payload: input.action.payload,
    status,
    effective,
    currentNodeId,
    continuePlanExecution: (continueInput) =>
      continuePlanExecution({ ...continueInput, workBlockId: executionSession.workBlockId }),
    resumePlanExecutionWithApproval: (approvalInput) =>
      resumePlanExecutionWithApproval({ ...approvalInput, workBlockId: executionSession.workBlockId }),
    dispatchExecutionAction,
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

// Re-exported for callers that referenced the trigger type via this module.
export type { ExecutionTrigger };

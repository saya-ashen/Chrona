/* eslint-disable max-lines-per-function, complexity -- Execution facade explicitly maps every private action and recovery authority variant. */
import { db } from "@/lib/db";
import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import { executionStatusFromEffectiveGraph } from "./execution-state-machine";
import { deriveExecutionCheckpoint } from "./execution-checkpoint";
import { resolveCheckpointAction } from "./execution-actions";
import type {
  CheckpointInputFields,
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
import type { SubmittedNodeResult } from "@chrona/contracts/plan-runtime/execution-command";
import { ensureNativePlanRun } from "./persistence/plan-runtime-store";
import { getPlanRun } from "./persistence/plan-run-store";
import { ensurePlanMainSession } from "./persistence/plan-state-store";
import { currentNodeFromEffective } from "./projection/execution-graph-selectors";
import { executeCommand } from "./kernel/execute-command";
import { resolveCheckpointTransition } from "./use-cases/checkpoint-transition/resolve-checkpoint-transition";
import { getCurrentExecution as readCurrentExecution } from "./use-cases/get-current-execution";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";
import { assertSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";
import { runWithSchedulerWorkContext } from "@/modules/orchestration/scheduler-work-context";

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
    workContext?: SchedulerWorkContext;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  return runWithSchedulerWorkContext(input.workContext, async () => {
    await assertSchedulerWorkOwnership(input.workContext);
    const execution = await executeCommand({
      taskId: input.taskId,
      command: { type: "start", trigger: input.trigger, prompt: input.prompt },
      context: { trigger: input.trigger, ...(Object.hasOwn(input, "workBlockId") ? { workBlockId: input.workBlockId ?? null } : {}) },
      workContext: input.workContext,
      onGraphEvent: input.onGraphEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      onStateChange: input.onStateChange,
    });
    await assertSchedulerWorkOwnership(input.workContext);
    return execution;
  });
}

export async function continuePlanExecution(
  input: {
    taskId: string;
    reason: string;
    userInput?: string;
    inputFields?: CheckpointInputFields;
    sessionId?: string;
    nodeId?: string;
    resumeReadyNode?: boolean;
    workBlockId?: string | null;
    idempotencyKey?: string;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  const command: ExecutionCommand =
    input.inputFields && Object.keys(input.inputFields).length > 0
      ? { type: "resume_with_input", nodeId: input.nodeId, inputFields: input.inputFields }
      : { type: "resume_after_unblock", nodeId: input.nodeId, note: input.userInput };
  return executeCommand({
    taskId: input.taskId,
    command,
    context: { sessionId: input.sessionId, ...(Object.hasOwn(input, "workBlockId") ? { workBlockId: input.workBlockId ?? null } : {}), idempotencyKey: input.idempotencyKey },
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
    idempotencyKey?: string;
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
    context: { sessionId: input.sessionId, ...(Object.hasOwn(input, "workBlockId") ? { workBlockId: input.workBlockId ?? null } : {}), idempotencyKey: input.idempotencyKey },
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}
function commandForExecutionAction(
  action: ExecutionActionWithContinuation,
  contextSessionId?: string | null,
): { command: ExecutionCommand; context: ExecutionCommandContext } {
  const sessionId = contextSessionId ?? undefined;
  const context: ExecutionCommandContext = {
    sessionId,
    ...("workBlockId" in action ? { workBlockId: action.workBlockId ?? null } : {}),
    idempotencyKey: action.idempotencyKey,
  };

  switch (action.action) {
    case "start_manual":
      return {
        command: { type: "start", trigger: "manual", prompt: action.prompt },
        context: { ...context, trigger: "manual" },
      };
    case "restart_from_beginning":
      return {
        command: { type: "restart_from_beginning", trigger: "manual", prompt: action.prompt },
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
    case "complete_manual_node": {
      const result: SubmittedNodeResult = {
        kind: "done",
        summary: action.summary,
        output: action.output,
        evidence: sessionId ? { sessionId } : undefined,
        selectedBranch: action.selectedBranch,
        branchRef: action.branchRef,
        deliverables: action.deliverables,
        findings: action.findings,
        decisions: action.decisions,
        caveats: action.caveats,
        nextActions: action.nextActions,
        resultEvidence: action.evidenceItems?.map((item) => ({
          ...item,
          sourceNodeRef: "",
        })),
      };
      return {
        command: {
          type: "submit_node_result",
          nodeId: action.nodeId,
          expectedAttemptId: action.expectedAttemptId,
          runtimeRunRef: action.runtimeRunRef,
          providerRunId: action.providerRunId,
          result,
          continueExecution: action.continueExecution ?? true,
        },
        context,
      };
    }
    case "block_current_node":
      return {
        command: {
          type: "submit_node_result",
          nodeId: action.nodeId,
          expectedAttemptId: action.expectedAttemptId,
          runtimeRunRef: action.runtimeRunRef,
          providerRunId: action.providerRunId,
          result: { kind: "blocked", reason: action.reason, actionForm: action.actionForm },
        },
        context,
      };
    case "fail_current_node":
      return {
        command: {
          type: "submit_node_result",
          nodeId: action.nodeId,
          expectedAttemptId: action.expectedAttemptId,
          runtimeRunRef: action.runtimeRunRef,
          providerRunId: action.providerRunId,
          result: { kind: "failed", error: action.error },
        },
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

async function bindCurrentTerminalAttempt(
  taskId: string,
  command: ExecutionCommand,
  context: ExecutionCommandContext,
): Promise<ExecutionCommand> {
  if (command.type !== "submit_node_result" || command.expectedAttemptId || command.runtimeRunRef) return command;
  const terminalCommand = command;
  const session = context.sessionId
    ? await db.executionSession.findFirst({
        where: {
          id: context.sessionId,
          taskId,
        },
        select: {
          currentNodeAttemptId: true,
          currentNodeId: true,
          planId: true,
          status: true,
          workBlockId: true,
        },
      })
    : await db.executionSession.findFirst({
        where: {
          taskId,
          workBlockId: context.workBlockId ?? null,
          activeScopeKey: "active",
          status: { in: ["Active", "Paused"] },
        },
        select: {
          currentNodeAttemptId: true,
          currentNodeId: true,
          planId: true,
          workBlockId: true,
          status: true,
        },
      });
  if (context.sessionId && !session) {
    throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Execution session does not exist for this terminal action");
  }
  if (context.sessionId && session && !["Active", "Paused"].includes(session.status)) {
    const current = await readCurrentExecution({ taskId, workBlockId: session.workBlockId });
    if (current.status === "completed" || current.status === "cancelled") return command;
    throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Execution session is not active for this terminal action");
  }
  if (session && context.workBlockId !== undefined && context.workBlockId !== session.workBlockId) {
    throw new EngineError(ENGINE_ERROR_CODES.CONFLICT, "Execution session does not match the terminal action scope");
  }
  if (!session?.planId) return command;
  const runtime = await getPlanRun(taskId, session.planId, session.workBlockId);
  const checkpointResult = [...(runtime?.results ?? [])].reverse().find((result) =>
    result.nodeId === session.currentNodeId
    && result.status === "current"
    && result.waitKind
    && result.attemptId
  );
  const attemptId = session.currentNodeAttemptId ?? checkpointResult?.attemptId;
  if (!attemptId) return command;
  const attempt = await db.taskPlanNodeAttempt.findFirst({
    where: {
      id: attemptId,
      taskId,
      planRun: { workBlockId: session.workBlockId },
    },
    select: { id: true, nodeId: true, status: true },
  });
  if (!attempt) return command;
  if (["succeeded", "failed", "cancelled"].includes(attempt.status)) {
    const exactCheckpoint = [...(runtime?.results ?? [])].reverse().find((result) =>
      result.nodeId === attempt.nodeId
      && result.attemptId === attempt.id
      && result.status === "current"
      && result.waitKind
    );
    if (!exactCheckpoint) return command;
  }
  return { ...terminalCommand, expectedAttemptId: attempt.id };
}

export async function dispatchExecutionAction(
  input: {
    taskId: string;
    action: ExecutionActionWithContinuation;
    commandContext?: ExecutionDispatchContext;
  } & PlanExecutionObserver,
): Promise<PlanExecutionResult> {
  const { command: requestedCommand, context } = commandForExecutionAction(input.action, input.commandContext?.sessionId);
  const command = await bindCurrentTerminalAttempt(input.taskId, requestedCommand, context);
  return executeCommand({
    taskId: input.taskId,
    command,
    context: {
      ...context,
      sessionId: context.sessionId ?? input.commandContext?.sessionId ?? undefined,
      idempotencyKey: context.idempotencyKey ?? input.commandContext?.idempotencyKey ?? undefined,
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
    planRunId: runtime.persisted.id,
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
    idempotencyKey: input.action.idempotencyKey,
    planRunId: runtime.persisted.id,
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
      continuePlanExecution({
        ...continueInput,
        workBlockId: executionSession.workBlockId,
        idempotencyKey: continueInput.idempotencyKey ?? input.action.idempotencyKey,
      }),
    resumePlanExecutionWithApproval: (approvalInput) =>
      resumePlanExecutionWithApproval({
        ...approvalInput,
        workBlockId: executionSession.workBlockId,
        idempotencyKey: approvalInput.idempotencyKey ?? input.action.idempotencyKey,
      }),
    dispatchExecutionAction: (dispatchInput) =>
      dispatchExecutionAction({
        ...dispatchInput,
        commandContext: {
          ...dispatchInput.commandContext,
          idempotencyKey: dispatchInput.commandContext?.idempotencyKey ?? input.action.idempotencyKey,
        },
      }),
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

// Re-exported for callers that referenced the trigger type via this module.
export type { ExecutionTrigger };

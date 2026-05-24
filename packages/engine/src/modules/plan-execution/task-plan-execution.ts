import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import {
  ensurePlanMainSession,
  appendMainSessionEvent,
} from "./plan-state-store";
import {
  resolveEffectivePlanGraph,
  createGraphRuntime,
} from "@chrona/graph-runtime";
import {
  executionStatusFromEffectiveGraph,
} from "./execution-state-machine";
import { deriveExecutionCheckpoint } from "./execution-checkpoint";
import {
  resolveCheckpointAction,
} from "./execution-actions";
import type {
  EffectivePlanGraph,
  NodeResult,
  PlanExecutionResult,
  PlanExecutionStatus,
  SubmitCheckpointActionInput,
  SubmitCheckpointActionResult,
  WaitKind,
} from "@chrona/contracts/ai";
import {
  type AdvanceRuntimeCommand,
  type EngineRuntimeContext,
  type ExecutionActionWithContinuation,
  type OrchestratorTrigger,
  type PlanExecutionControl,
  type PlanExecutionObserver,
} from "./types";
import {
  activateWorkBlock,
} from "./persistence/work-block-store";
import {
  type ExecutionSessionRow,
  ensureExecutionSession,
} from "./persistence/execution-session-store";
import {
  acquireExecutionLease,
  releaseExecutionLease,
  type ExecutionLeaseScope,
} from "./persistence/execution-lease-store";
import { buildExecutionResponse } from "./projection/execution-response";
import {
  ensureNativePlanRun,
} from "./persistence/plan-runtime-store";
import {
  currentNodeFromEffective,
  currentNodeFromOutcome,
  latestStartedNodeId,
} from "./projection/execution-graph-selectors";
import { getRuntimeName } from "./persistence/task-runtime-store";
import { toGraphExecutionState } from "./runtime/graph-state";
import {
  committedStateIfNodeAdvanced,
  committedStateIfRunningNodeAdvanced,
} from "./runtime/committed-state";
import { buildAdvanceDispatchCommand } from "./runtime/advance-dispatch/build-advance-dispatch-command";
import { createExecutionGraphCallbacks } from "./runtime/graph-runtime-callbacks";
import {
  abortTaskExecution,
  clearTaskExecutionControl,
  createTaskExecutionControl,
  requestTaskExecutionPause,
} from "./runtime/execution-control-registry";
import {
  convergeExecutionToCommittedState,
} from "./use-cases/execution-lifecycle";
import { handleAdvanceOutcome } from "./use-cases/advance-outcome";
import { dispatchRuntimeCommandAction } from "./use-cases/dispatch-runtime-command-action";
import { getCurrentExecution } from "./use-cases/get-current-execution";
import { resolveCheckpointTransition } from "./use-cases/checkpoint-transition/resolve-checkpoint-transition";
export { syncPlanRunRuntimeResult } from "./use-cases/sync-runtime-result/sync-plan-run-runtime-result";
export { getCurrentExecution } from "./use-cases/get-current-execution";
export { submitTerminalNodeResult } from "./use-cases/submit-terminal-node-result";

const DEFAULT_MAX_STEPS = 10;

function mapTerminalReasonToStatus(
  effective: EffectivePlanGraph,
): PlanExecutionStatus {
  return executionStatusFromEffectiveGraph(effective);
}

function formatInputFields(inputFields: Record<string, string>) {
  return Object.entries(inputFields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

async function advancePlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  mainSession: { id: string; taskId: string; sessionKey: string };
  executionSession: ExecutionSessionRow;
  maxSteps?: number;
  forcedNodeId?: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  forcedReplaceStatus?: NonNullable<NodeResult["status"]>;
  command?: AdvanceRuntimeCommand;
  control?: PlanExecutionControl;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
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
    };
  }

  const runtimeName = await getRuntimeName(input.taskId);
  const state = toGraphExecutionState(runtime.persisted);
  const context: EngineRuntimeContext = {
    taskId: input.taskId,
    planId: runtime.planId,
    mainSession: input.mainSession,
    control: input.control,
  };
  const graphRuntime = createGraphRuntime<EngineRuntimeContext>({
    taskId: input.taskId,
    runtimeName,
    policies: { maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS },
    control: input.control,
    callbacks: createExecutionGraphCallbacks({
      taskId: input.taskId,
      planId: runtime.planId,
      workspaceId: runtime.workspaceId,
      compiledPlan: runtime.compiledPlan,
      persisted: runtime.persisted,
      runtimeName,
      trigger: input.trigger,
      mainSession: input.mainSession,
      executionSession: input.executionSession,
      committedStateIfRunningNodeAdvanced,
      onGraphEvent: input.onGraphEvent,
      onRuntimeEvent: input.onRuntimeEvent,
      onStateChange: input.onStateChange,
    }),
  });
  const dispatchResolution = buildAdvanceDispatchCommand({
    state,
    trigger: input.trigger,
    context,
    executionSession: input.executionSession,
    forcedNodeId: input.forcedNodeId,
    userInput: input.userInput,
    inputFields: input.inputFields,
    forcedReplaceStatus: input.forcedReplaceStatus,
    command: input.command,
  });
  if (dispatchResolution.type === "already_completed") {
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.mainSession.id,
      status: "completed",
      effective: dispatchResolution.effective,
      currentNodeId: null,
      executedNodeIds: dispatchResolution.effective.completedNodeIds,
      message: "Execution already completed; node result ignored.",
    });
  }
  const outcome = await graphRuntime.dispatch(dispatchResolution.command);
  const staleRunningNodeId =
    outcome.status === "running"
      ? currentNodeFromOutcome(outcome) ?? latestStartedNodeId(outcome.events)
      : null;
  const committed = outcome.status === "running"
    ? await committedStateIfNodeAdvanced({
        taskId: input.taskId,
        planId: runtime.planId,
        nodeId: staleRunningNodeId,
        results: outcome.state.results as unknown as NodeResult[],
      })
    : null;

  if (committed) {
    return convergeExecutionToCommittedState({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: input.mainSession.id,
      session: input.executionSession,
      workspaceId: runtime.workspaceId,
      compiledPlan: runtime.compiledPlan,
      committed,
      fallbackMessage: outcome.message,
    });
  }

  return handleAdvanceOutcome({
    taskId: input.taskId,
    mainSessionId: input.mainSession.id,
    runtime,
    executionSession: input.executionSession,
    outcome,
  });
}

async function withExecutionLease(input: {
  workspaceId: string;
  taskId: string;
  planId: string;
  ownerId: string;
  scope: ExecutionLeaseScope;
  run: () => Promise<PlanExecutionResult>;
}) {
  const lease = await acquireExecutionLease({
    taskId: input.taskId,
    planId: input.planId,
    ownerId: input.ownerId,
    scope: input.scope,
  });

  if (!lease) {
    await appendCanonicalEvent({
      eventType: "execution.lease_ignored",
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      actorType: "runtime",
      actorId: input.scope,
      source: "execution-kernel",
      payload: {
        planId: input.planId,
        ownerId: input.ownerId,
        scope: input.scope,
        reason: "active_execution_owner",
      },
      dedupeKey: `execution.lease_ignored:${input.taskId}:${input.planId}:${input.ownerId}`,
      runtimeTs: new Date(),
    });
    return getCurrentExecution({ taskId: input.taskId });
  }

  try {
    return await input.run();
  } finally {
    await releaseExecutionLease({
      planRunId: lease.planRunId,
      ownerId: lease.ownerId,
      epoch: lease.epoch,
    });
  }
}

async function withTaskExecutionControl(
  taskId: string,
  run: (control: PlanExecutionControl) => Promise<PlanExecutionResult>,
) {
  const control = createTaskExecutionControl(taskId);
  try {
    return await run(control);
  } finally {
    clearTaskExecutionControl(taskId);
  }
}

export async function startPlanExecution(input: {
  taskId: string;
  trigger: OrchestratorTrigger;
  prompt?: string;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
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
    };
  }

  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: input.trigger,
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  await activateWorkBlock(input.taskId, executionSession.workBlockId);
  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    eventType: "execution_started",
    payload: { trigger: input.trigger, prompt: input.prompt },
  });

  return withExecutionLease({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    ownerId: executionSession.id,
    scope: input.trigger === "scheduler" ? "system" : "manual",
    run: () =>
      withTaskExecutionControl(input.taskId, (control) =>
        advancePlanExecution({
          taskId: input.taskId,
          trigger: input.trigger,
          mainSession,
          executionSession,
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      ),
  });
}

export async function continuePlanExecution(input: {
  taskId: string;
  reason: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  sessionId?: string;
  nodeId?: string;
  resumeReadyNode?: boolean;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
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
    };
  }

  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: "manual",
    sessionId: input.sessionId,
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  if (input.userInput) {
    await appendMainSessionEvent({
      taskId: input.taskId,
      planId: runtime.planId,
      sessionId: mainSession.id,
      eventType: "user_input_received",
      payload: { input: input.userInput, reason: input.reason },
    });
  }

  const effective = resolveEffectivePlanGraph({
    graph: runtime.persisted.graph!,
    attempts: runtime.persisted.attempts,
    results: runtime.persisted.results,
  });
  const waitingNode =
    (input.nodeId
      ? effective.nodes.find((node) => node.id === input.nodeId)
      : null) ??
    effective.nodes.find(
      (node) => node.id === executionSession.currentNodeId,
    ) ??
    effective.nodes.find(
      (node) =>
        node.status === "waiting_for_user" ||
        node.status === "waiting_for_approval" ||
        node.status === "blocked",
    ) ??
    null;
  const readyNode = input.resumeReadyNode
    ? effective.nodes.find((node) => node.ready)
    : null;

  return withExecutionLease({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    ownerId: executionSession.id,
    scope: "manual",
    run: () =>
      withTaskExecutionControl(input.taskId, (control) =>
        advancePlanExecution({
          taskId: input.taskId,
          trigger: "manual",
          mainSession,
          executionSession,
          userInput: input.userInput,
          inputFields: input.inputFields,
          forcedNodeId: readyNode?.id ?? waitingNode?.id,
          forcedReplaceStatus: "obsolete",
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      ),
  });
}

async function resumePlanExecutionWithApproval(input: {
  taskId: string;
  sessionId?: string;
  nodeId?: string;
  approved: boolean;
  feedback?: string;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
  if (!runtime) {
    return {
      taskId: input.taskId,
      planId: null,
      mainSessionId: input.sessionId ?? null,
      status: "no_plan",
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "No accepted plan. Create or accept a plan before execution.",
    };
  }

  const executionSession = await ensureExecutionSession({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    trigger: "manual",
    sessionId: input.sessionId,
  });
  const mainSession = await ensurePlanMainSession({
    taskId: input.taskId,
    planId: runtime.planId,
  });

  const effective = resolveEffectivePlanGraph({
    graph: runtime.persisted.graph!,
    attempts: runtime.persisted.attempts,
    results: runtime.persisted.results,
  });
  const waitingNode =
    (input.nodeId
      ? effective.nodes.find((node) => node.id === input.nodeId)
      : null) ??
    effective.nodes.find((node) => node.id === executionSession.currentNodeId) ??
    effective.nodes.find((node) => node.status === "waiting_for_approval") ??
    null;

  if (!waitingNode) {
    return buildExecutionResponse({
      taskId: input.taskId,
      planId: runtime.planId,
      mainSessionId: mainSession.id,
      status: mapTerminalReasonToStatus(effective),
      effective,
      currentNodeId: null,
      executedNodeIds: [],
      message: "No approval-waiting node found.",
    });
  }

  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: runtime.planId,
    sessionId: mainSession.id,
    eventType: "user_input_received",
    payload: {
      reason: input.approved ? "approval:approve" : "approval:reject",
      feedback: input.feedback,
      nodeId: waitingNode.id,
    },
  });

  return withExecutionLease({
    workspaceId: runtime.workspaceId,
    taskId: input.taskId,
    planId: runtime.planId,
    ownerId: executionSession.id,
    scope: "manual",
    run: () =>
      withTaskExecutionControl(input.taskId, (control) =>
        advancePlanExecution({
          taskId: input.taskId,
          trigger: "manual",
          mainSession,
          executionSession,
          command: {
            type: "resume_with_approval",
            nodeId: waitingNode.id,
            approved: input.approved,
            feedback: input.feedback,
          },
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      ),
  });
}

export async function dispatchExecutionAction(input: {
  taskId: string;
  action: ExecutionActionWithContinuation;
} & PlanExecutionObserver): Promise<PlanExecutionResult> {
  switch (input.action.action) {
    case "start_manual":
      return startPlanExecution({
        taskId: input.taskId,
        trigger: "manual",
        prompt: input.action.prompt,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "start_scheduled":
      return startPlanExecution({
        taskId: input.taskId,
        trigger: "scheduler",
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "resume_with_input":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "user_input",
        userInput: formatInputFields(input.action.inputFields),
        inputFields: input.action.inputFields,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "resume_with_approval":
      return resumePlanExecutionWithApproval({
        taskId: input.taskId,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        approved: input.action.decision === "approve",
        feedback: input.action.feedback ?? input.action.editedContent,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "resume_after_unblock":
      return continuePlanExecution({
        taskId: input.taskId,
        reason: "resume_after_unblock",
        userInput: input.action.note,
        sessionId: input.action.sessionId,
        nodeId: input.action.nodeId,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    case "complete_manual_node": {
      const action = input.action;
      return withTaskExecutionControl(input.taskId, (control) =>
        dispatchRuntimeCommandAction({
          taskId: input.taskId,
          action,
          advance: advancePlanExecution,
          withExecutionLease,
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      );
    }
    case "block_current_node": {
      const action = input.action;
      return withTaskExecutionControl(input.taskId, (control) =>
        dispatchRuntimeCommandAction({
          taskId: input.taskId,
          action,
          advance: advancePlanExecution,
          withExecutionLease,
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      );
    }
    case "fail_current_node": {
      const action = input.action;
      return withTaskExecutionControl(input.taskId, (control) =>
        dispatchRuntimeCommandAction({
          taskId: input.taskId,
          action,
          advance: advancePlanExecution,
          withExecutionLease,
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      );
    }
    case "retry_node": {
      const action = input.action;
      return withTaskExecutionControl(input.taskId, (control) =>
        dispatchRuntimeCommandAction({
          taskId: input.taskId,
          action,
          advance: advancePlanExecution,
          withExecutionLease,
          control,
          onGraphEvent: input.onGraphEvent,
          onRuntimeEvent: input.onRuntimeEvent,
          onStateChange: input.onStateChange,
        }),
      );
    }
    case "pause_session": {
      if (requestTaskExecutionPause(input.taskId)) {
        return getCurrentExecution({ taskId: input.taskId });
      }
      return dispatchRuntimeCommandAction({
        taskId: input.taskId,
        action: input.action,
        advance: advancePlanExecution,
        withExecutionLease,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    }
    case "cancel_session": {
      abortTaskExecution({
        taskId: input.taskId,
        reason: input.action.reason,
      });
      return dispatchRuntimeCommandAction({
        taskId: input.taskId,
        action: input.action,
        advance: advancePlanExecution,
        withExecutionLease,
        onGraphEvent: input.onGraphEvent,
        onRuntimeEvent: input.onRuntimeEvent,
        onStateChange: input.onStateChange,
      });
    }
    default: {
      const exhaustiveCheck: never = input.action;
      throw new Error(
        `Unsupported execution action: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

export async function submitCheckpointAction(input: {
  taskId: string;
  action: SubmitCheckpointActionInput;
} & PlanExecutionObserver): Promise<SubmitCheckpointActionResult> {
  const runtime = await ensureNativePlanRun(input.taskId);
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
  }) as unknown as EffectivePlanGraph;
  const status = mapTerminalReasonToStatus(effective);
  const currentNodeId = currentNodeFromEffective(effective)?.id ?? executionSession.currentNodeId;
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
    continuePlanExecution,
    resumePlanExecutionWithApproval,
    dispatchExecutionAction,
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  });
}

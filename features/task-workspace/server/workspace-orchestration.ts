/* eslint-disable complexity, max-lines-per-function, max-statements, max-depth, max-lines -- Workspace orchestration keeps exact execution authority transitions colocated. */
import {
  appendTaskWorkspaceEvent,
  getCurrentExecution,
  headerExecutionStateToStatePaths,
  publishTaskStateUpdate,
  publishTaskWorkspaceUpdatedEvent,
  resolveHeaderExecutionState,
  type ChronaEngine,
} from "@chrona/engine";
import {
  workCommandBodySchema,
  type ExecutionActionInput,
  type GeneratePlanSSEEvent,
  type SubmitCheckpointActionInput,
} from "@chrona/contracts";
import { toHttpError } from "@shared/http/server";
import { checkpointActionToExecutionAction, summarizeRuntimeEvent } from "@features/execution-monitoring/server";

export async function getTaskWorkspaceId(engine: ChronaEngine, taskId: string) {
  const page = await engine.tasks.getBootstrap({ taskId });
  return page.task.workspaceId;
}

function publishCommandEvent(input: {
  taskId: string;
  workspaceId: string;
  commandId: string;
  commandType: string;
  type: "command.accepted" | "command.failed";
  message?: string;
  workBlockId?: string | null;
}) {
  appendTaskWorkspaceEvent({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    commandId: input.commandId,
    commandType: input.commandType,
    type: input.type,
    workBlockId: input.workBlockId,
    ...(input.message ? { message: input.message } : {}),
  });
}

function commandWorkBlockId(command: ReturnType<typeof workCommandBodySchema.parse>) {
  return "workBlockId" in command ? command.workBlockId ?? null : null;
}

function publishWorkspaceTrigger(input: {
  taskId: string;
  workspaceId: string;
  commandId: string;
  type: "plan.generation.event" | "execution.runtime_event" | "execution.state.updated" | "execution.result" | "checkpoint.result";
  eventKind?: string;
  [key: string]: unknown;
}) {
  appendTaskWorkspaceEvent(input);
}

function resetPlanGenerationHeaderState(input: {
  taskId: string;
  workspaceId: string;
  workBlockId: string | null;
}) {
  publishTaskStateUpdate({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    workBlockId: input.workBlockId,
    updates: {
      "/plan/generation/is-running": false,
      "/plan/generation/header-action-disabled": false,
    },
  });
}

export async function buildTaskWorkspaceStateSnapshot(
  engine: ChronaEngine,
  input: { taskId: string; workBlockId: string | null },
): Promise<Record<string, unknown>> {
  const [state, currentExecution] = await Promise.all([
    engine.tasks.plan.getState({
      taskId: input.taskId,
      workBlockId: input.workBlockId,
    }),
    getCurrentExecution({ taskId: input.taskId, workBlockId: input.workBlockId }),
  ]);
  const session = state.generationSession;
  const hasPlan = Boolean(state.savedPlan);
  const hasAcceptedPlan = state.savedPlan?.status === "accepted";
  const executionState = resolveHeaderExecutionState({
    executionStatus: currentExecution.status,
    hasPlan,
    hasAcceptedPlan,
    isRunnable: currentExecution.status !== "no_plan",
    startDisabledReason: deriveStartDisabledReason(currentExecution.status, hasPlan, hasAcceptedPlan),
  });
  return {
    "/plan/status": state.aiPlanGenerationStatus,
    "/plan/saved/id": state.savedPlan?.id ?? null,
    "/plan/saved/status": state.savedPlan?.status ?? null,
    "/plan/saved/revision": state.savedPlan?.revision ?? null,
    "/plan/generation/id": session?.generationId ?? null,
    "/plan/generation/head-state-version": session?.headStateVersion ?? null,
    "/plan/generation/status": session?.status ?? null,
    "/plan/generation/phase": session?.phase ?? null,
    "/plan/generation/statusMessage": session?.statusMessage ?? null,
    "/plan/generation/error/message": session?.error?.message ?? null,
    "/plan/generation/error/code": session?.error?.code ?? null,
    "/plan/generation/is-running": session?.status === "running",
    "/plan/generation/header-action-disabled": session?.status === "running",
    "/plan/generation/stop-disabled": false,
    ...headerExecutionStateToStatePaths(executionState),
  };
}

function deriveStartDisabledReason(
  executionStatus: string,
  hasPlan: boolean,
  hasAcceptedPlan: boolean,
): string | null {
  if (!hasPlan) return "Generate and accept a plan before starting execution.";
  if (!hasAcceptedPlan) return "Accept the generated plan before starting execution.";
  if (executionStatus === "no_plan") return "Generate and accept a plan before starting execution.";
  if (executionStatus === "running") return "Task is already running.";
  if (executionStatus === "waiting_for_user" || executionStatus === "waiting_for_approval") {
    return "Task is waiting for checkpoint input.";
  }
  if (executionStatus === "blocked" || executionStatus === "failed") {
    return "Resolve the blocker before starting execution.";
  }
  if (executionStatus === "completed" || executionStatus === "cancelled") {
    return "Task is completed.";
  }
  return null;
}

async function buildHeaderExecutionStateUpdate(input: {
  engine: ChronaEngine;
  taskId: string;
  workBlockId: string | null;
  executionStatus: string;
}): Promise<Record<string, unknown> | null> {
  const state = await input.engine.tasks.plan.getState({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
  });
  const hasPlan = Boolean(state.savedPlan);
  const hasAcceptedPlan = state.savedPlan?.status === "accepted";
  const executionState = resolveHeaderExecutionState({
    executionStatus: input.executionStatus,
    hasPlan,
    hasAcceptedPlan,
    isRunnable: input.executionStatus !== "no_plan",
    startDisabledReason: deriveStartDisabledReason(input.executionStatus, hasPlan, hasAcceptedPlan),
  });
  return headerExecutionStateToStatePaths(executionState);
}

function planGenerationStateUpdate(event: GeneratePlanSSEEvent): Record<string, unknown> | null {
  switch (event.type) {
    case "status":
      return {
        "/plan/status": "generating",
        "/plan/generation/status": "running",
        "/plan/generation/phase": event.phase,
        "/plan/generation/statusMessage": event.message,
      };
    case "committed":
      return {
        "/plan/saved/id": event.planId,
        "/plan/status": "waiting_acceptance",
        "/plan/generation/status": "completed",
        "/plan/generation/head-state-version": event.headStateVersion,
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    case "stale":
      return {
        "/plan/status": "idle",
        "/plan/generation/status": "failed",
        "/plan/generation/error/code": event.code,
        "/plan/generation/error/message": event.message,
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    case "failed":
      return {
        "/plan/status": "idle",
        "/plan/generation/status": "failed",
        "/plan/generation/error/code": event.code,
        "/plan/generation/error/message": event.message,
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    case "cancelled":
      return {
        "/plan/status": "idle",
        "/plan/generation/status": "cancelled",
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    case "done":
      return {
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
  }
}

function optimisticExecutionStatusForAction(action: ExecutionActionInput["action"]): string | null {
  if (action === "start_manual" || action === "restart_from_beginning" || action === "retry_node") return "running";
  if (action === "pause_session") return "waiting_for_user";
  if (action === "cancel_session") return "cancelled";
  return null;
}

export async function dispatchTaskWorkspaceCommand(engine: ChronaEngine, input: {
  taskId: string;
  workspaceId: string;
  commandId: string;
  command: ReturnType<typeof workCommandBodySchema.parse>;
}) {
  const { taskId, workspaceId, commandId, command } = input;
  publishCommandEvent({
    taskId,
    workspaceId,
    commandId,
    commandType: command.type,
    type: "command.accepted",
    workBlockId: commandWorkBlockId(command),
  });

  try {
    if (command.type === "plan.generate") {
      if (command.replaceActiveExecution) {
        const current = await engine.tasks.execution.current({
          taskId,
          workBlockId: command.workBlockId ?? null,
        });
        if (!["completed", "cancelled", "failed"].includes(current.status)) {
          await engine.tasks.execution.dispatch({
            taskId,
            action: { action: "cancel_session" },
            commandContext: {
              sessionId: current.mainSessionId ?? undefined,
              idempotencyKey: `${command.idempotencyKey}:cancel-active-execution`,
            },
          });
        }
      }
      const workBlockId = commandWorkBlockId(command);
      publishTaskStateUpdate({
        taskId,
        workspaceId,
        workBlockId,
        updates: {
          "/plan/status": "generating",
          "/plan/generation/status": "running",
          "/plan/generation/phase": "connecting",
          "/plan/generation/statusMessage": "Starting plan generation...",
          "/plan/generation/error/code": null,
          "/plan/generation/error/message": null,
          "/plan/generation/is-running": true,
          "/plan/generation/header-action-disabled": true,
          "/plan/generation/stop-disabled": false,
        },
      });
      const generation = await engine.tasks.plan.generate({
        taskId,
        workBlockId: command.workBlockId ?? null,
        forceRefresh: command.forceRefresh ?? true,
        userInstruction: command.userInstruction ?? undefined,
        selectedNodeId: command.selectedNodeId ?? null,
        idempotencyKey: command.idempotencyKey,
      });
      try {
        for await (const event of generation.events) {
          generation.emit(event);
          const stateUpdate = planGenerationStateUpdate(event);
          if (stateUpdate) {
            publishTaskStateUpdate({ taskId, workspaceId, workBlockId, updates: stateUpdate });
          }
        }
      } finally {
        generation.finish();
      }
      resetPlanGenerationHeaderState({ taskId, workspaceId, workBlockId });
      appendTaskWorkspaceEvent({
        type: "task_workspace_updated",
        taskId,
        workspaceId,
        workBlockId,
        reason: "plan_generation.completed",
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (command.type === "plan.stop_generation") {
      const workBlockId = commandWorkBlockId(command);
      await engine.tasks.plan.stopGeneration({ taskId, workBlockId });
      resetPlanGenerationHeaderState({ taskId, workspaceId, workBlockId });
      appendTaskWorkspaceEvent({
        type: "task_workspace_updated",
        taskId,
        workspaceId,
        workBlockId,
        reason: "plan.generation.stopped",
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (command.type === "plan.accept") {
      await engine.tasks.plan.accept({
        taskId,
        planId: command.planId,
        workBlockId: command.workBlockId ?? null,
        expectedHeadStateVersion: command.expectedHeadStateVersion,
        idempotencyKey: command.idempotencyKey,
      });
      const headerStateUpdate = await buildHeaderExecutionStateUpdate({
        engine,
        taskId,
        workBlockId: commandWorkBlockId(command),
        executionStatus: "started",
      });
      if (headerStateUpdate) {
        publishTaskStateUpdate({
          taskId,
          workspaceId,
          workBlockId: commandWorkBlockId(command),
          updates: headerStateUpdate,
        });
      }
      publishTaskWorkspaceUpdatedEvent({
        taskId,
        workspaceId,
        workBlockId: commandWorkBlockId(command),
        reason: "plan.accepted",
      });
      return;
    }

    if (command.type === "execution.action") {
      const action = { ...command, action: command.action } as ExecutionActionInput;
      const workBlockId = commandWorkBlockId(command);
      const optimisticStatus = optimisticExecutionStatusForAction(action.action);
      if (optimisticStatus) {
        const optimisticHeaderState = await buildHeaderExecutionStateUpdate({
          engine,
          taskId,
          workBlockId,
          executionStatus: optimisticStatus,
        });
        if (optimisticHeaderState) {
          publishTaskStateUpdate({
            taskId,
            workspaceId,
            workBlockId,
            updates: optimisticHeaderState,
          });
        }
      }
      const result = await engine.tasks.execution.dispatch({
        taskId,
        action,
        onGraphEvent(event) {
          publishWorkspaceTrigger({
            taskId,
            workspaceId,
            workBlockId,
            commandId,
            type: "execution.runtime_event",
            eventKind: event.type,
          });
        },
        onRuntimeEvent(event) {
          const summary = summarizeRuntimeEvent(action.action, event);
          if (!summary) return;
          const { type: _runtimeType, provider, runtime, event: runtimeEvent, ...runtimePayload } = summary;
          const tool = "tool" in runtimeEvent ? runtimeEvent.tool : undefined;
          publishWorkspaceTrigger({
            taskId,
            workspaceId,
            commandId,
            workBlockId,
            type: "execution.runtime_event",
            eventKind: event.event.type,
            providerLabel: provider.label,
            runtimeLabel: runtime.label,
            ...(tool ? { event: { ...runtimeEvent, toolLabel: tool.label } } : { event: runtimeEvent }),
            ...runtimePayload,
          });
        },
        onStateChange() {
          publishWorkspaceTrigger({
            taskId,
            workspaceId,
            workBlockId,
            commandId,
            type: "execution.state.updated",
            eventKind: "state",
          });
        },
      });
      const headerStateUpdate = await buildHeaderExecutionStateUpdate({
        engine,
        taskId,
        workBlockId,
        executionStatus: result.status,
      });
      if (headerStateUpdate) {
        publishTaskStateUpdate({
          taskId,
          workspaceId,
          workBlockId,
          updates: headerStateUpdate,
        });
      }
      publishWorkspaceTrigger({
        taskId,
        workspaceId,
        workBlockId,
        commandId,
        type: "execution.result",
        eventKind: result.status,
      });
      return;
    }

    const workBlockId = commandWorkBlockId(command);
    const result = await engine.tasks.execution.submitCheckpointAction({
      taskId,
      action: {
        checkpointId: command.checkpointId,
        action: command.action,
        payload: command.payload,
        workBlockId,
        idempotencyKey: command.idempotencyKey,
      } as SubmitCheckpointActionInput,
      onGraphEvent(event) {
        publishWorkspaceTrigger({
          taskId,
          workspaceId,
          workBlockId,
          commandId,
          type: "execution.runtime_event",
          eventKind: event.type,
        });
      },
      onRuntimeEvent(event) {
        const summary = summarizeRuntimeEvent(checkpointActionToExecutionAction(command.action), event);
        if (!summary) return;
        const { type: _runtimeType, provider, runtime, event: runtimeEvent, ...runtimePayload } = summary;
        const tool = "tool" in runtimeEvent ? runtimeEvent.tool : undefined;
        publishWorkspaceTrigger({
          taskId,
          workspaceId,
          commandId,
          workBlockId,
          type: "execution.runtime_event",
          eventKind: event.event.type,
          providerLabel: provider.label,
          runtimeLabel: runtime.label,
          ...(tool ? { event: { ...runtimeEvent, toolLabel: tool.label } } : { event: runtimeEvent }),
          ...runtimePayload,
        });
      },
      onStateChange() {
        publishWorkspaceTrigger({
          taskId,
          workspaceId,
          workBlockId,
          commandId,
          type: "execution.state.updated",
          eventKind: "state",
        });
      },
    });
    const headerStateUpdate = await buildHeaderExecutionStateUpdate({
      engine,
      taskId,
      workBlockId,
      executionStatus: result.execution.status,
    });
    if (headerStateUpdate) {
      publishTaskStateUpdate({
        taskId,
        workspaceId,
        workBlockId,
        updates: headerStateUpdate,
      });
    }
    publishWorkspaceTrigger({
      taskId,
      workspaceId,
      workBlockId,
      commandId,
      type: "checkpoint.result",
      eventKind: result.execution.status,
    });
  } catch (cause) {
    const httpError = toHttpError(cause);
    const workBlockId = commandWorkBlockId(command);
    publishCommandEvent({
      taskId,
      workspaceId,
      commandId,
      commandType: command.type,
      type: "command.failed",
      workBlockId,
      message: httpError?.message ?? (cause instanceof Error ? cause.message : "Workspace command failed"),
    });
    if (command.type === "plan.generate") {
      resetPlanGenerationHeaderState({ taskId, workspaceId, workBlockId });
    }
  }
}

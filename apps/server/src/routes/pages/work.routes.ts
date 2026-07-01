import { Hono } from "hono";
import { createLogger } from "@chrona/logging";

import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { randomUUID } from "node:crypto";
import { appendTaskWorkspaceEvent, getCurrentExecution, headerExecutionStateToStatePaths, publishTaskStateUpdate, publishTaskWorkspaceUpdatedEvent, resolveHeaderExecutionState, subscribeToTaskProjectionEvents, type ChronaEngine, type TaskProjectionEvent } from "@chrona/engine";
import { workCommandBodySchema, workProjectionParamSchema } from "@chrona/contracts/api";
import type { GeneratePlanSSEEvent } from "@chrona/contracts";
import type { ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";

import { error, internalServerError, json, toHttpError } from "../../lib/http";
import { heartbeatDelayMs } from "../../lib/sse-heartbeat";
import { checkpointActionToExecutionAction, summarizeRuntimeEvent } from "../../../../../features/execution-monitoring/server/runtime-event-summary";

const logger = createLogger("apps.server.work");

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function writeWorkEvent(stream: SseStream, event: TaskProjectionEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

async function getWorkspaceId(engine: ChronaEngine, taskId: string) {
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

/**
 * Build the initial state payload pushed on SSE connect. The shape is a
 * flat `Record<string, unknown>` keyed by JSON Pointer paths, matching
 * `StateStore.update` from `@json-render/core`. New state paths must be
 * declared here AND registered as `$state` expressions in the consuming
 * spec elements.
 */
async function buildTaskWorkspaceStateSnapshot(
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
  // Surface the live execution state through the same `state.update`
  // channel the spec reads from — the Start / Pause / Stop buttons in
  // the header card bind their `visible` / `disabled` to these paths.
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
    "/plan/generation/status": session?.status ?? null,
    "/plan/generation/phase": session?.phase ?? null,
    "/plan/generation/partialText": session?.partialText ?? "",
    "/plan/generation/statusMessage": session?.statusMessage ?? null,
    "/plan/generation/error/message": session?.error?.message ?? null,
    "/plan/generation/error/code": session?.error?.code ?? null,
    "/plan/generation/is-running": session?.status === "running",
    "/plan/generation/header-action-disabled": session?.status === "running",
    "/plan/generation/stop-disabled": false,
    ...headerExecutionStateToStatePaths(executionState),
  };
}

/**
 * English-only reason the Start button is currently disabled. Mirrors
 * the disabled-reason logic in `task-workspace-query.ts#buildTaskHeaderView`
 * — kept verbatim on the server so the state store can be populated
 * without round-tripping through the i18n module. The header card
 * surfaces this string as the `title` tooltip on the disabled button;
 * the page can re-translate it on the client if needed.
 */
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

/**
 * Project the engine's post-execution-action state onto the JSON
 * Pointer paths the header spec reads from. Returns `null` when the
 * caller didn't supply the required state inputs (e.g. for a `command.failed`
 * branch) so the SSE publisher can no-op cleanly.
 */
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

/**
 * Project a single plan-generation SSE event into a `state.update`
 * payload. Returns `null` when the event has no state-bearing meaning
 * for the workspace UI (e.g. `ready`, `heartbeat`).
 */
function planGenerationStateUpdate(event: GeneratePlanSSEEvent): Record<string, unknown> | null {
  switch (event.type) {
    case "status":
      return {
        "/plan/status": "generating",
        "/plan/generation/status": "running",
        "/plan/generation/phase": event.phase,
        "/plan/generation/statusMessage": event.message,
      };
    case "tool_call":
      return {
        "/plan/status": "generating",
        "/plan/generation/status": "running",
        "/plan/generation/lastTool": event.tool,
        "/plan/generation/lastToolAt": new Date().toISOString(),
      };
    case "partial":
      return { "/plan/status": "generating", "/plan/generation/status": "running", "/plan/generation/partialText": event.text };
    case "result":
      return {
        "/plan/saved/id": event.result.id,
        "/plan/saved/status": event.result.status,
        "/plan/saved/revision": event.result.revision,
        "/execution/has-plan": true,
        "/execution/has-accepted-plan": false,
        "/execution/show-accept-plan": true,
        "/execution/show-generate-plan": false,
        "/execution/can-start": false,
        "/execution/start-disabled": true,
        "/execution/start-disabled-reason": "Accept the generated plan before starting execution.",
        "/plan/status": "waiting_acceptance",
        "/plan/generation/status": "completed",
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    case "cancelled":
    case "done":
      return {
        "/plan/status": "idle",
        "/plan/generation/status": event.type,
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    case "error": {
      // Surface a `state.update` so the header spec can render an inline
      // error Alert and a recovery-actions row. `buttonRetry` /
      // `buttonEditInstruction` / `buttonCancel` are pre-defined boolean
      // flags the spec gates its recovery buttons on; the server picks
      // which ones are appropriate for the failure class.
      const retryable = event.code !== "TASK_NOT_FOUND";
      return {
        "/plan/status": "idle",
        "/plan/generation/error/code": event.code,
        "/plan/generation/error/message": event.message,
        "/plan/generation/error/buttonRetry": retryable,
        "/plan/generation/error/buttonEditInstruction": true,
        "/plan/generation/error/buttonCancel": false,
        "/plan/generation/is-running": false,
        "/plan/generation/header-action-disabled": false,
      };
    }
    default:
      return null;
  }
}


function optimisticExecutionStatusForAction(action: ExecutionActionInput["action"]): string | null {
  if (action === "start_manual") return "running";
  if (action === "pause_session") return "waiting_for_user";
  if (action === "cancel_session") return "cancelled";
  return null;
}
async function dispatchWorkspaceCommand(engine: ChronaEngine, input: {
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
      const generation = engine.tasks.plan.generate({
        taskId,
        workBlockId: command.workBlockId ?? null,
        forceRefresh: command.forceRefresh ?? true,
        userInstruction: command.userInstruction ?? undefined,
      });
      for await (const event of generation.events) {
        generation.emit(event);
        // The plan stream is now driven exclusively through `state.update`:
        // each event type maps to a flat JSON Pointer path the client
        // StateProvider applies to the header store. The legacy
        // `plan.generation.event` trigger is intentionally not emitted —
        // its consumers (activity timeline, plan sidebar) read the same
        // data either from the StateProvider snapshot or the canonical
        // DB event log via REST hydration.
        const stateUpdate = planGenerationStateUpdate(event);
        if (stateUpdate) {
          publishTaskStateUpdate({
            taskId,
            workspaceId,
            workBlockId,
            updates: stateUpdate,
          });
        }
      }
      generation.finish();
      // Always restore the header generation state once the stream closes.
      // Terminal stream events normally do this; this extra reset covers
      // runners that close without a terminal event.
      resetPlanGenerationHeaderState({ taskId, workspaceId, workBlockId });
      // Single terminal `task_workspace_updated` for the whole plan stream
      // so the client can refresh the REST snapshot (savedPlan on success,
      // error state on failure). Intermediate `plan.generation.status` /
      // `tool.called` / `started` events are deliberately not broadcast —
      // their UI state already flows through `state.update` events emitted
      // in the for-await loop above.
      appendTaskWorkspaceEvent({
        type: "task_workspace_updated",
        taskId,
        workspaceId,
        workBlockId,
        reason: "plan.generation.finished",
        updatedAt: new Date().toISOString(),
      });
      return;
    }


    if (command.type === "plan.stop_generation") {
      const workBlockId = commandWorkBlockId(command);
      engine.tasks.plan.stopGeneration({ taskId, workBlockId });
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
      await engine.tasks.plan.accept({ taskId, planId: command.planId, workBlockId: command.workBlockId ?? null });
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
      // Acceptance flips the task's accepted plan + primary action
      // (Accept plan → Start plan). rebuildTaskProjection already
      // publishes `task_projection_updated` (which the SSE pipe also
      // routes to the client), but we publish a dedicated
      // `task_workspace_updated` here as well: the workspace stream
      // gateway treats it as the canonical "REST snapshot is stale,
      // refetch" trigger, and emitting both makes the auto-refresh
      // path independent of the rebuild path's event ordering. The
      // other state-mutating commands (`plan.generate`, `result.accept`)
      // already do this; plan.accept was the odd one out.
      publishTaskWorkspaceUpdatedEvent({
        taskId,
        workspaceId,
        workBlockId: commandWorkBlockId(command),
        reason: "plan.accepted",
      });
      return;
    }
    if (command.type === "execution.action") {
      const action = {
        ...command,
        action: command.action,
      } as ExecutionActionInput;
      const optimisticStatus = optimisticExecutionStatusForAction(action.action);
      if (optimisticStatus) {
        const optimisticHeaderState = await buildHeaderExecutionStateUpdate({
          engine,
          taskId,
          workBlockId: commandWorkBlockId(command),
          executionStatus: optimisticStatus,
        });
        if (optimisticHeaderState) {
          publishTaskStateUpdate({
            taskId,
            workspaceId,
            workBlockId: commandWorkBlockId(command),
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
            commandId,
            type: "execution.runtime_event",
            eventKind: event.type,
          });
        },
        onRuntimeEvent(event) {
          const { type: _runtimeType, ...runtimePayload } = summarizeRuntimeEvent(action.action, event);
          publishWorkspaceTrigger({
            taskId,
            workspaceId,
            commandId,
            type: "execution.runtime_event",
            eventKind: event.event.type,
            ...runtimePayload,
          });
        },
        onStateChange() {
          publishWorkspaceTrigger({
            taskId,
            workspaceId,
            commandId,
            type: "execution.state.updated",
            eventKind: "state",
          });
        },
      });
      // After the dispatch settles, push the post-action execution
      // state onto the workspace header state store so the Start /
      // Pause / Stop buttons in the spec re-render without waiting
      // for a follow-up page refetch. `state.update` is a
      // workspace-state event the SSE handler already routes through
      // the StateProvider — it does not trigger a workspace refresh.
      const headerStateUpdate = await buildHeaderExecutionStateUpdate({
        engine,
        taskId,
        workBlockId: commandWorkBlockId(command),
        executionStatus: result.status,
      });
      if (headerStateUpdate) {
        publishTaskStateUpdate({
          taskId,
          workspaceId,
          workBlockId: commandWorkBlockId(command),
          updates: headerStateUpdate,
        });
      }
      publishWorkspaceTrigger({ taskId, workspaceId, commandId, type: "execution.result", eventKind: result.status });
      return;
    }

    const result = await engine.tasks.execution.submitCheckpointAction({
      taskId,
      action: {
        checkpointId: command.checkpointId,
        action: command.action,
        payload: command.payload,
        workBlockId: command.workBlockId ?? null,
        idempotencyKey: command.idempotencyKey,
      } as SubmitCheckpointActionInput,
      onGraphEvent(event) {
        publishWorkspaceTrigger({
          taskId,
          workspaceId,
          commandId,
          type: "execution.runtime_event",
          eventKind: event.type,
        });
      },
      onRuntimeEvent(event) {
        const { type: _runtimeType, ...runtimePayload } = summarizeRuntimeEvent(checkpointActionToExecutionAction(command.action), event);
        publishWorkspaceTrigger({
          taskId,
          workspaceId,
          commandId,
          type: "execution.runtime_event",
          eventKind: event.event.type,
          ...runtimePayload,
        });
      },
      onStateChange() {
        publishWorkspaceTrigger({ taskId, workspaceId, commandId, type: "execution.state.updated", eventKind: "state" });
      },
    });
    // Push the post-checkpoint execution state onto the header
    // state store so the action buttons re-render in lockstep
    // with the runtime — same contract as `execution.action`.
    const headerStateUpdate = await buildHeaderExecutionStateUpdate({
      engine,
      taskId,
      workBlockId: commandWorkBlockId(command),
      executionStatus: result.execution.status,
    });
    if (headerStateUpdate) {
      publishTaskStateUpdate({
        taskId,
        workspaceId,
        workBlockId: commandWorkBlockId(command),
        updates: headerStateUpdate,
      });
    }
    publishWorkspaceTrigger({ taskId, workspaceId, commandId, type: "checkpoint.result", eventKind: result.execution.status });
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

export function createWorkRoutes(engine: ChronaEngine) {
  return new Hono()
    .post(
      "/work/:taskId/commands",
      zValidator("param", workProjectionParamSchema),
      zValidator("json", workCommandBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const command = c.req.valid("json");
          const commandId = command.idempotencyKey ?? randomUUID();
          const workspaceId = await getWorkspaceId(engine, taskId);

          void dispatchWorkspaceCommand(engine, { taskId, workspaceId, commandId, command });

          return json(c, {
            commandId,
            taskId,
            acceptedAt: new Date().toISOString(),
          }, 202);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/work/:taskId/commands", cause, "Failed to dispatch workspace command");
        }
      },
    )
    .get("/work/:taskId/events", zValidator("param", workProjectionParamSchema), async (c) => {
      const { taskId } = c.req.valid("param");
      const workBlockId = c.req.query("workBlockId") ?? null;

      return streamSSE(c, async (stream) => {
        let writeQueue = Promise.resolve();
        const writeQueued = (write: () => Promise<unknown>) => {
          writeQueue = writeQueue.then(async () => {
            try {
              await write();
            } catch (cause) {
              logger.warn("work_sse.write_failed", {
                taskId,
                error: cause,
              });
              throw cause;
            }
          }).then(() => undefined);
          return writeQueue;
        };
        const writeEvent = (event: TaskProjectionEvent) => writeQueued(() => writeWorkEvent(stream, event));
        const writeHeartbeat = () => writeQueued(async () => {
          await stream.writeSSE({ event: "heartbeat", data: "{}" });
        });
        const writeSnapshot = (state: Record<string, unknown>) => writeQueued(async () => {
          const workspaceId = await getWorkspaceId(engine, taskId);
          const event = appendTaskWorkspaceEvent({
            type: "state.snapshot",
            taskId,
            workspaceId,
            workBlockId,
            state,
          });
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        });
        let isClosed = false;
        let resolveClosed: (() => void) | null = null;
        const closed = new Promise<void>((resolve) => {
          resolveClosed = () => {
            isClosed = true;
            resolve();
          };
        });
        const heartbeatLoop = async () => {
          while (!isClosed) {
            await stream.sleep(heartbeatDelayMs());
            if (isClosed) break;
            await writeHeartbeat();
          }
        };

        const subscription = subscribeToTaskProjectionEvents(taskId, (event) => {
          void writeEvent(event);
        });

        stream.onAbort(() => {
          subscription.unsubscribe();
          resolveClosed?.();
        });

        try {
          const snapshot = await buildTaskWorkspaceStateSnapshot(engine, { taskId, workBlockId });
          await writeSnapshot(snapshot);
          await writeQueued(() => stream.writeSSE({ event: "ready", data: JSON.stringify({ taskId }) }));
          await writeHeartbeat();
          await Promise.race([closed, heartbeatLoop()]);
        } finally {
          isClosed = true;
          await writeQueue;
          subscription.unsubscribe();
        }
      });
    });
}

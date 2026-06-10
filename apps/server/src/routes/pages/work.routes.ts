import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { appendTaskWorkspaceEvent, publishTaskStateUpdate, subscribeToTaskProjectionEvents, type ChronaEngine, type TaskProjectionEvent } from "@chrona/engine";
import { workCommandBodySchema, workProjectionParamSchema } from "@chrona/contracts/api";
import type { GeneratePlanSSEEvent } from "@chrona/contracts";
import type { ExecutionActionInput, SubmitCheckpointActionInput } from "@chrona/contracts/ai";

import { error, internalServerError, json, toHttpError } from "../../lib/http";
import { checkpointActionToExecutionAction, summarizeRuntimeEvent } from "../tasks/runtime-event-summary";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;
const WORKSPACE_SSE_HEARTBEAT_INTERVAL_MS = 5000;

function writeWorkEvent(stream: SseStream, event: TaskProjectionEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

async function getWorkspaceId(engine: ChronaEngine, taskId: string) {
  const work = await engine.pages.getWork({ taskId });
  return work.taskShell.workspaceId;
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

function resetGeneratePlanActionPatch(input: {
  taskId: string;
  workspaceId: string;
  workBlockId: string | null;
}) {
  appendTaskWorkspaceEvent({
    type: "spec.patch",
    document: "header",
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    workBlockId: input.workBlockId,
    patches: [
      { op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generate plan" },
      { op: "remove", path: "/elements/action:generate-plan/props/disabled" },
    ],
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
  const state = await engine.tasks.plan.getState({
    taskId: input.taskId,
    workBlockId: input.workBlockId,
  });
  const session = state.generationSession;
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
  };
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
        "/plan/generation/phase": event.phase,
        "/plan/generation/statusMessage": event.message,
      };
    case "tool_call":
      return {
        "/plan/generation/lastTool": event.tool,
        "/plan/generation/lastToolAt": new Date().toISOString(),
      };
    case "partial":
      return { "/plan/generation/partialText": event.text };
    case "result":
      return {
        "/plan/saved/id": event.result.id,
        "/plan/saved/status": event.result.status,
        "/plan/saved/revision": event.result.revision,
        "/plan/generation/status": "completed",
      };
    case "cancelled":
    case "done":
      return { "/plan/generation/status": event.type };
    case "error": {
      // Surface a `state.update` so the header spec can render an inline
      // error Alert and a recovery-actions row. `buttonRetry` /
      // `buttonEditInstruction` / `buttonCancel` are pre-defined boolean
      // flags the spec gates its recovery buttons on; the server picks
      // which ones are appropriate for the failure class.
      const retryable = event.code !== "TASK_NOT_FOUND";
      return {
        "/plan/generation/error/code": event.code,
        "/plan/generation/error/message": event.message,
        "/plan/generation/error/buttonRetry": retryable,
        "/plan/generation/error/buttonEditInstruction": true,
        "/plan/generation/error/buttonCancel": false,
      };
    }
    default:
      return null;
  }
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
      appendTaskWorkspaceEvent({
        type: "spec.patch",
        document: "header",
        taskId,
        workspaceId,
        workBlockId,
        patches: [
          { op: "replace", path: "/elements/action:generate-plan/props/label", value: "Generate plan..." },
          { op: "replace", path: "/elements/action:generate-plan/props/disabled", value: true },
        ],
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
      // Always restore the header action to its idle state once the
      // generation stream closes — success, error, and cancel all leave the
      // button in a "Generate plan" / enabled state so the user can retry.
      resetGeneratePlanActionPatch({ taskId, workspaceId, workBlockId });
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

    if (command.type === "plan.accept") {
      await engine.tasks.plan.accept({ taskId, planId: command.planId, workBlockId: command.workBlockId ?? null });
      return;
    }
    if (command.type === "execution.action") {
      const action = {
        ...command,
        action: command.action,
      } as ExecutionActionInput;
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
      resetGeneratePlanActionPatch({ taskId, workspaceId, workBlockId });
    }
  }
}

export function createWorkRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/work/:taskId", zValidator("param", workProjectionParamSchema), async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        return json(c, await engine.pages.getWork({ taskId }));
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(c, "GET /api/work/:taskId", cause, "Failed to get work page");
      }
    })
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
              console.warn("[work-sse] write failed", {
                taskId,
                error: cause instanceof Error ? cause.message : String(cause),
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
            await stream.sleep(WORKSPACE_SSE_HEARTBEAT_INTERVAL_MS);
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

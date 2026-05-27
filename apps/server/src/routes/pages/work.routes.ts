import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { appendTaskWorkspaceEvent, subscribeToTaskProjectionEvents, type ChronaEngine, type TaskProjectionEvent } from "@chrona/engine";
import { workCommandBodySchema, workProjectionParamSchema } from "@chrona/contracts/api";
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
}) {
  appendTaskWorkspaceEvent({
    type: input.type,
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    commandId: input.commandId,
    commandType: input.commandType,
    message: input.message,
  });
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

async function dispatchWorkspaceCommand(engine: ChronaEngine, input: {
  taskId: string;
  workspaceId: string;
  commandId: string;
  command: ReturnType<typeof workCommandBodySchema.parse>;
}) {
  const { taskId, workspaceId, commandId, command } = input;
  publishCommandEvent({ taskId, workspaceId, commandId, commandType: command.type, type: "command.accepted" });

  try {
    if (command.type === "plan.generate") {
      const generation = engine.tasks.plan.generate({
        taskId,
        forceRefresh: command.forceRefresh ?? true,
        userInstruction: command.userInstruction ?? undefined,
      });
      for await (const event of generation.events) {
        generation.emit(event);
        publishWorkspaceTrigger({
          taskId,
          workspaceId,
          commandId,
          type: "plan.generation.event",
          eventKind: event.type,
        });
      }
      generation.finish();
      return;
    }

    if (command.type === "plan.accept") {
      const result = await engine.tasks.plan.accept({ taskId, planId: command.planId });
      publishWorkspaceTrigger({
        taskId,
        workspaceId,
        commandId,
        type: "plan.generation.event",
        eventKind: result.savedPlan?.status ?? "accepted",
      });
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
    publishCommandEvent({
      taskId,
      workspaceId,
      commandId,
      commandType: command.type,
      type: "command.failed",
      message: httpError?.message ?? (cause instanceof Error ? cause.message : "Workspace command failed"),
    });
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

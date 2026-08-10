import { Hono } from "hono";
import { createLogger } from "@chrona/logging";

import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { appendTaskWorkspaceEvent, subscribeToTaskProjectionEvents, type ChronaEngine, type TaskProjectionEvent } from "@chrona/engine";
import { workCommandBodySchema, workProjectionParamSchema } from "@chrona/contracts/api";
import { buildTaskWorkspaceStateSnapshot, dispatchTaskWorkspaceCommand, getTaskWorkspaceId } from "@features/task-workspace/server";
import { error, internalServerError, json, toHttpError } from "../../lib/http";
import { heartbeatDelayMs } from "../../lib/sse-heartbeat";

const logger = createLogger("apps.server.work");

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function writeWorkEvent(stream: SseStream, event: TaskProjectionEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

function createWorkEventStream(
  engine: ChronaEngine,
  taskId: string,
  workBlockId: string | null,
) {
  return async (stream: SseStream) => {
    let writeQueue = Promise.resolve();
    const writeQueued = (write: () => Promise<unknown>) => {
      writeQueue = writeQueue.then(async () => {
        try {
          await write();
        } catch (cause) {
          logger.warn("work_sse.write_failed", { taskId, error: cause });
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
      const workspaceId = await getTaskWorkspaceId(engine, taskId);
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
  };
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
          const commandId = command.idempotencyKey;
          const workspaceId = await getTaskWorkspaceId(engine, taskId);

          if (command.type === "execution.action") {
            await dispatchTaskWorkspaceCommand(engine, { taskId, workspaceId, commandId, command });
          } else {
            void dispatchTaskWorkspaceCommand(engine, { taskId, workspaceId, commandId, command });
          }

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
      return streamSSE(c, createWorkEventStream(engine, taskId, workBlockId));
    });
}

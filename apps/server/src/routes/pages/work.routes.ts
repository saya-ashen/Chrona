import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { subscribeToTaskProjectionEvents, type ChronaEngine, type TaskProjectionEvent } from "@chrona/engine";
import { workProjectionParamSchema } from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function writeWorkEvent(stream: SseStream, event: TaskProjectionEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
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
    .get("/work/:taskId/events", zValidator("param", workProjectionParamSchema), async (c) => {
      const { taskId } = c.req.valid("param");

      return streamSSE(c, async (stream) => {
        let writeQueue = Promise.resolve();
        const writeEvent = (event: TaskProjectionEvent) => {
          writeQueue = writeQueue.then(() => writeWorkEvent(stream, event)).then(() => undefined);
          return writeQueue;
        };

        const heartbeat = setInterval(() => {
          void stream.writeSSE({ event: "heartbeat", data: "{}" }).catch(() => undefined);
        }, 15000);

        const subscription = subscribeToTaskProjectionEvents(taskId, (event) => {
          void writeEvent(event);
        });

        stream.onAbort(() => {
          clearInterval(heartbeat);
          subscription.unsubscribe();
        });

        try {
          await stream.writeSSE({ event: "ready", data: JSON.stringify({ taskId }) });
          await new Promise<void>((resolve) => {
            stream.onAbort(() => resolve());
          });
        } finally {
          await writeQueue;
          clearInterval(heartbeat);
          subscription.unsubscribe();
        }
      });
    });
}

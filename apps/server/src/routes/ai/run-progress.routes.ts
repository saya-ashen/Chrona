import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import {
  aiRunProgressOperationParamSchema,
  type AiRunProgressEvent,
} from "@chrona/contracts/api";
import { subscribeToAiRunProgress } from "@chrona/engine";

import { error } from "../../lib/http";
import { startSseHeartbeat } from "../../lib/sse-heartbeat";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function writeProgressEvent(stream: SseStream, event: AiRunProgressEvent) {
  return stream.writeSSE({ event: "progress", data: JSON.stringify(event) });
}

export function createAiRunProgressRoutes() {
  return new Hono().get(
    "/ai/runs/:operationId/events",
    zValidator("param", aiRunProgressOperationParamSchema),
    async (c) => {
      const { operationId } = c.req.valid("param");
      const bufferedEvents: AiRunProgressEvent[] = [];
      let active = false;
      let enqueueEvent: ((event: AiRunProgressEvent) => void) | null = null;
      const subscription = subscribeToAiRunProgress({
        operationId,
        onEvent(event) {
          if (active) enqueueEvent?.(event);
          else bufferedEvents.push(event);
        },
      });
      if (!subscription) return error(c, "AI run not found", 404);

      return streamSSE(c, async (stream) => {
        const stopHeartbeat = startSseHeartbeat(stream);
        let resolveClosed: (() => void) | null = null;
        const closed = new Promise<void>((resolve) => {
          resolveClosed = resolve;
        });
        let writeQueue = Promise.resolve();
        let terminalSeen = false;
        const queueEvent = (event: AiRunProgressEvent) => {
          writeQueue = writeQueue.then(() => writeProgressEvent(stream, event)).then(() => undefined);
          if (event.phase === "completed" || event.phase === "failed") {
            terminalSeen = true;
            void writeQueue.finally(() => resolveClosed?.());
          }
        };

        enqueueEvent = queueEvent;
        active = true;
        for (const event of bufferedEvents) queueEvent(event);
        bufferedEvents.length = 0;

        stream.onAbort(() => {
          stopHeartbeat();
          subscription.unsubscribe();
          resolveClosed?.();
        });

        try {
          if (terminalSeen) await writeQueue;
          else await closed;
        } finally {
          subscription.unsubscribe();
          stopHeartbeat();
          await writeQueue;
        }
      });
    },
  );
}

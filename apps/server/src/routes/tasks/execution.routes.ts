import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  checkpointActionBodySchema,
  checkpointActionParamSchema,
  executionActionBodySchema,
  executionActionParamSchema,
} from "@chrona/contracts/api";
import type { PlanExecutionSSEEvent } from "@chrona/contracts";
import type { EffectivePlanGraph } from "@chrona/contracts/ai";
import type {
  GraphExecutionEvent,
  PlanExecutionRuntimeEvent,
} from "@chrona/engine/modules/plan-execution";

import { error, toHttpError } from "../../lib/http";
import { checkpointActionToExecutionAction, summarizeRuntimeEvent } from "./runtime-event-summary";

type SseStream = Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never;

function startSseHeartbeat(stream: SseStream) {
  const timer = setInterval(() => {
    void stream.writeSSE({ event: "heartbeat", data: "{}" }).catch(() => undefined);
  }, 5_000);
  return () => clearInterval(timer);
}

function summarizeGraphEvent(event: GraphExecutionEvent): Extract<PlanExecutionSSEEvent, { type: "graph_event" }> {
  if ("node" in event) {
    const result = "result" in event ? event.result : null;
    const message = result && "summary" in result
      ? result.summary
      : result && "error" in result
        ? result.error
        : result && "reason" in result
          ? result.reason
          : undefined;
    return {
      type: "graph_event",
      event: event.type,
      nodeId: event.node.id,
      nodeTitle: event.node.title,
      status: result?.status,
      message,
    };
  }

  return { type: "graph_event", event: event.type };
}

function writeExecutionEvent(stream: SseStream, event: PlanExecutionSSEEvent) {
  return stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
}

export function createExecutionRoutes(engine: ChronaEngine) {
  return new Hono().get(
    "/tasks/:taskId/execution/current",
    zValidator("param", executionActionParamSchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const result = await engine.tasks.execution.current({ taskId });
        return c.json(result);
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to load current execution state", 500);
      }
    },
  ).post(
    "/tasks/:taskId/execution/actions",
    zValidator("param", executionActionParamSchema),
    zValidator("json", executionActionBodySchema),
    async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        const action = c.req.valid("json");

        return streamSSE(c, async (stream) => {
          const stopHeartbeat = startSseHeartbeat(stream);
          let writeQueue = Promise.resolve();
          const writeEvent = (event: PlanExecutionSSEEvent) => {
            writeQueue = writeQueue.then(() => writeExecutionEvent(stream, event)).then(() => undefined);
            return writeQueue;
          };

          stream.onAbort(() => {
            stopHeartbeat();
          });

          try {
            await writeEvent({
              type: "status",
              action: action.action,
              message: "Plan execution started.",
            });

            const result = await engine.tasks.execution.dispatch({
              taskId,
              action,
              onGraphEvent(event: GraphExecutionEvent) {
                void writeEvent(summarizeGraphEvent(event));
              },
              onRuntimeEvent(event: PlanExecutionRuntimeEvent) {
                void writeEvent(summarizeRuntimeEvent(action.action, event));
              },
              onStateChange(effectivePlan: EffectivePlanGraph) {
                void writeEvent({
                  type: "state",
                  effectivePlan,
                });
              },
            });

            await writeEvent({ type: "result", result });
            await writeEvent({ type: "done" });
          } catch (cause) {
            const httpError = toHttpError(cause);
            await writeEvent({
              type: "error",
              code: "INTERNAL_ERROR",
              message: httpError?.message ?? (cause instanceof Error ? cause.message : "Failed to dispatch execution action"),
            });
            await writeEvent({ type: "done" });
          } finally {
            await writeQueue;
            stopHeartbeat();
          }
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to dispatch execution action", 500);
      }
    },
  ).post(
    "/tasks/:taskId/execution/checkpoint/:checkpointId/actions",
    zValidator("param", checkpointActionParamSchema),
    zValidator("json", checkpointActionBodySchema),
    async (c) => {
      try {
        const { taskId, checkpointId } = c.req.valid("param");
        const action = c.req.valid("json");

        return streamSSE(c, async (stream) => {
          const stopHeartbeat = startSseHeartbeat(stream);
          let writeQueue = Promise.resolve();
          const writeEvent = (event: PlanExecutionSSEEvent) => {
            writeQueue = writeQueue.then(() => writeExecutionEvent(stream, event)).then(() => undefined);
            return writeQueue;
          };
          const executionAction = checkpointActionToExecutionAction(action.action);

          stream.onAbort(() => {
            stopHeartbeat();
          });

          try {
            await writeEvent({
              type: "status",
              action: executionAction,
              message: "Checkpoint action submitted.",
            });

            const result = await engine.tasks.execution.submitCheckpointAction({
              taskId,
              action: { checkpointId, ...action },
              onGraphEvent(event: GraphExecutionEvent) {
                void writeEvent(summarizeGraphEvent(event));
              },
              onRuntimeEvent(event: PlanExecutionRuntimeEvent) {
                void writeEvent(summarizeRuntimeEvent(executionAction, event));
              },
              onStateChange(effectivePlan: EffectivePlanGraph) {
                void writeEvent({
                  type: "state",
                  effectivePlan,
                });
              },
            });

            await writeEvent({ type: "result", result: result.execution });
            await writeEvent({ type: "done" });
          } catch (cause) {
            const httpError = toHttpError(cause);
            await writeEvent({
              type: "error",
              code: "INTERNAL_ERROR",
              message: httpError?.message ?? (cause instanceof Error ? cause.message : "Failed to submit checkpoint action"),
            });
            await writeEvent({ type: "done" });
          } finally {
            await writeQueue;
            stopHeartbeat();
          }
        });
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return error(c, cause instanceof Error ? cause.message : "Failed to submit checkpoint action", 500);
      }
    },
  );
}

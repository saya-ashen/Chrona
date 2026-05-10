import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { ENGINE_ERROR_CODES, EngineError, type ChronaEngine } from "@chrona/engine";
import { createDebugDump, previewDebugValue } from "@chrona/shared/debug-dump";
import {
  planStateParamSchema,
  planAcceptParamSchema,
  planAcceptBodySchema,
  planGenerateActiveParamSchema,
  planGenerateParamSchema,
  planGenerateBodySchema,
  planGenerateStopParamSchema,
  planPatchParamSchema,
  planPatchBodySchema,
} from "@chrona/contracts/api";
import { logger, planGenerationConflictBody } from "../helpers";
import { error, internalServerError, json, toHttpError } from "../../lib/http";

function writePlanGenerationEvent(
  stream: Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never,
  event: import("@chrona/contracts").GeneratePlanSSEEvent,
) {
  switch (event.type) {
    case "status":
      return stream.writeSSE({
        event: "status",
        data: JSON.stringify({ phase: event.phase, message: event.message }),
      });
    case "tool_call":
      return stream.writeSSE({
        event: "tool_call",
        data: JSON.stringify({ tool: event.tool, input: event.input }),
      });
    case "partial":
      return stream.writeSSE({ event: "partial", data: JSON.stringify({ text: event.text }) });
    case "result":
      return stream.writeSSE({ event: "result", data: JSON.stringify(event) });
    case "error":
      return stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          code: event.code,
          message: event.message,
          rawText: event.rawText,
          diagnostics: event.diagnostics,
        }),
      });
    case "cancelled":
      return stream.writeSSE({ event: "cancelled", data: "{}" });
    case "done":
      return stream.writeSSE({ event: "done", data: "{}" });
  }
}

function startSseHeartbeat(
  stream: Parameters<typeof streamSSE>[1] extends (stream: infer T) => Promise<unknown> ? T : never,
) {
  const timer = setInterval(() => {
    void stream.writeSSE({ event: "heartbeat", data: "{}" }).catch(() => undefined);
  }, 5_000);
  return () => clearInterval(timer);
}

function summarizePlanGenerationEvent(
  event: import("@chrona/contracts").GeneratePlanSSEEvent,
) {
  switch (event.type) {
    case "partial":
      return {
        type: event.type,
        textLength: event.text.length,
        text: previewDebugValue(event.text, 300),
      };
    case "tool_call":
      return {
        type: event.type,
        tool: event.tool,
        input: previewDebugValue(event.input, 1200),
      };
    case "result":
      return {
        type: event.type,
        result: previewDebugValue(event.result, 1200),
        taskSessionKey: event.taskSessionKey,
      };
    case "error":
      return {
        type: event.type,
        code: event.code,
        message: event.message,
        diagnostics: previewDebugValue(event.diagnostics, 1200),
      };
    default:
      return { ...event };
  }
}

export function createPlansRoutes(engine: ChronaEngine) {
  return new Hono()
    .get(
      "/tasks/:taskId/plan",
      zValidator("param", planStateParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.plan.getState({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "GET /api/tasks/:taskId/plan", cause, "Failed to get task plan state");
        }
      },
    )
    .post(
      "/tasks/:taskId/plan/accept",
      zValidator("param", planAcceptParamSchema),
      zValidator("json", planAcceptBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { planId, workspaceId } = c.req.valid("json");

          return json(c, await engine.tasks.plan.accept({ taskId, planId, workspaceId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/plan/accept", cause, "Failed to accept task AI plan");
        }
      },
    )
    .get(
      "/tasks/:taskId/plan/generations/active",
      zValidator("param", planGenerateActiveParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, engine.tasks.plan.getActiveGeneration({ taskId }));
        } catch (cause) {
          return internalServerError(
            c,
            "GET /api/tasks/:taskId/plan/generations/active",
            cause,
            "Failed to get active task plan generation",
          );
        }
      },
    )
    .get(
      "/tasks/:taskId/plan/generations/active/events",
      zValidator("param", planGenerateActiveParamSchema),
      async (c) => {
        const { taskId } = c.req.valid("param");
        const active = engine.tasks.plan.getActiveGeneration({ taskId }).generationSession;
        if (!active) {
          return error(c, "No active task plan generation", 404);
        }

        return streamSSE(c, async (stream) => {
          const stopHeartbeat = startSseHeartbeat(stream);
          const dump = await createDebugDump({
            enabledEnv: "CHRONA_AI_STREAM_DUMP",
            directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
            kind: "ai-stream",
            label: `server-active-${taskId}-${active.generationId}`,
            meta: {
              layer: "server.plan.routes.active.events",
              taskId,
              generationId: active.generationId,
            },
          });
          let resolveClosed: (() => void) | null = null;
          const closed = new Promise<void>((resolve) => {
            resolveClosed = resolve;
          });

          const current = engine.tasks.plan.getActiveGeneration({ taskId }).generationSession;
          if (current && current.generationId === active.generationId) {
            await dump?.write({
              type: "write_sse",
              event: "session",
              snapshot: previewDebugValue(current, 1200),
            });
            await stream.writeSSE({
              event: "session",
              data: JSON.stringify({ generationId: current.generationId, snapshot: current }),
            });
          }

          let writeQueue = Promise.resolve();
          const writeEvent = (event: import("@chrona/contracts").GeneratePlanSSEEvent) => {
            writeQueue = writeQueue
              .then(async () => {
                await dump?.write({
                  type: "write_sse",
                  event: event.type,
                  payload: summarizePlanGenerationEvent(event),
                });
                await writePlanGenerationEvent(stream, event);
              })
              .then(() => undefined);

            return writeQueue;
          };

          const subscription = engine.tasks.plan.subscribeToActiveGeneration({
            taskId,
            onEvent(event) {
              void dump?.write({
                type: "subscription_event",
                event: summarizePlanGenerationEvent(event),
              });
              void writeEvent(event);
              if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
                void writeQueue.finally(async () => {
                  await dump?.write({ type: "close", reason: event.type });
                  await dump?.close();
                  resolveClosed?.();
                });
              }
            },
          });

          if (!subscription || subscription.generationId !== active.generationId) {
            await dump?.write({ type: "write_sse", event: "done", reason: "subscription_missing" });
            await stream.writeSSE({ event: "done", data: "{}" });
            await dump?.close();
            return;
          }

          stream.onAbort(() => {
            void dump?.write({ type: "abort" }).finally(() => dump.close());
            stopHeartbeat();
            subscription.unsubscribe();
            resolveClosed?.();
          });

          try {
            await closed;
          } finally {
            stopHeartbeat();
          }
        });
      },
    )
    .post(
      "/tasks/:taskId/plan/generations/stop",
      zValidator("param", planGenerateStopParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, engine.tasks.plan.stopGeneration({ taskId }));
        } catch (cause) {
          return internalServerError(
            c,
            "POST /api/tasks/:taskId/plan/generations/stop",
            cause,
            "Failed to stop task plan generation",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/plan/generations",
      zValidator("param", planGenerateParamSchema),
      zValidator("json", planGenerateBodySchema),
      async (c) => {
        const { taskId } = c.req.valid("param");
        const { forceRefresh } = c.req.valid("json");
        try {
          const requestId = randomUUID();
          logger.info("request.start", {
            requestId,
            feature: "generate_plan",
            taskId,
            streaming: true,
            forceRefresh,
          });

          const generation = engine.tasks.plan.generate({ taskId, forceRefresh });
          const generatorDump = await createDebugDump({
            enabledEnv: "CHRONA_AI_STREAM_DUMP",
            directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
            kind: "ai-stream",
            label: `server-generator-${taskId}-${generation.generationId}`,
            meta: {
              layer: "server.plan.routes.generations.generator",
              requestId,
              taskId,
              generationId: generation.generationId,
              forceRefresh: forceRefresh ?? false,
            },
          });

          void (async () => {
            try {
              for await (const event of generation.events) {
                await generatorDump?.write({
                  type: "engine_event",
                  event: summarizePlanGenerationEvent(event),
                });
                generation.emit(event);
                await generatorDump?.write({
                  type: "registry_emit",
                  eventType: event.type,
                });
                logger.info("stream.event", {
                  requestId,
                  feature: "generate_plan",
                  taskId,
                  generationId: generation.generationId,
                  eventType: event.type,
                });

                if (event.type === "error") {
                  logger.error("request.stream_event_error", {
                    requestId,
                    feature: "generate_plan",
                    taskId,
                    code: event.code,
                    message: event.message,
                    rawText: event.rawText ?? null,
                    diagnostics: event.diagnostics ?? null,
                  });
                }
              }

              logger.info("request.done", {
                requestId,
                feature: "generate_plan",
                taskId,
                generationId: generation.generationId,
              });
            } catch (cause) {
              logger.error("request.stream_error", {
                requestId,
                feature: "generate_plan",
                taskId,
                generationId: generation.generationId,
                error: cause instanceof Error ? cause.message : String(cause),
              });
              const errorEvent: import("@chrona/contracts").GeneratePlanSSEEvent = {
                type: "error",
                code: "INTERNAL_ERROR",
                message: cause instanceof Error ? cause.message : "Failed to generate task plan",
              };
              await generatorDump?.write({
                type: "engine_error",
                message: cause instanceof Error ? cause.message : String(cause),
              });
              generation.emit(errorEvent);
              await generatorDump?.write({ type: "registry_emit", eventType: errorEvent.type });
            } finally {
              await generatorDump?.write({ type: "generation_finish" });
              await generatorDump?.close();
              generation.finish();
            }
          })();

          return streamSSE(c, async (stream) => {
            const stopHeartbeat = startSseHeartbeat(stream);
            const clientDump = await createDebugDump({
              enabledEnv: "CHRONA_AI_STREAM_DUMP",
              directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
              kind: "ai-stream",
              label: `server-client-${taskId}-${generation.generationId}`,
              meta: {
                layer: "server.plan.routes.generations.client",
                requestId,
                taskId,
                generationId: generation.generationId,
              },
            });
            let resolveClosed: (() => void) | null = null;
            const closed = new Promise<void>((resolve) => {
              resolveClosed = resolve;
            });

            let writeQueue = Promise.resolve();
            const writeEvent = (event: import("@chrona/contracts").GeneratePlanSSEEvent) => {
              writeQueue = writeQueue
                .then(async () => {
                  await clientDump?.write({
                    type: "write_sse",
                    event: event.type,
                    payload: summarizePlanGenerationEvent(event),
                  });
                  await writePlanGenerationEvent(stream, event);
                })
                .then(() => undefined);

              return writeQueue;
            };

            const subscription = engine.tasks.plan.subscribeToGeneration({
              generationId: generation.generationId,
              onEvent(event) {
                void clientDump?.write({
                  type: "subscription_event",
                  event: summarizePlanGenerationEvent(event),
                });
                void writeEvent(event);
                if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
                  void writeQueue.finally(async () => {
                    await clientDump?.write({ type: "close", reason: event.type });
                    await clientDump?.close();
                    resolveClosed?.();
                  });
                }
              },
            });

            if (!subscription) {
              await clientDump?.write({ type: "write_sse", event: "error", reason: "subscription_missing" });
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  code: "INTERNAL_ERROR",
                  message: "Failed to subscribe to task plan generation session",
                }),
              });
              await clientDump?.close();
              return;
            }

            stream.onAbort(() => {
              void clientDump?.write({ type: "abort" }).finally(() => clientDump.close());
              stopHeartbeat();
              subscription.unsubscribe();
              resolveClosed?.();
            });

            await clientDump?.write({ type: "write_sse", event: "session", generationId: generation.generationId });
            await stream.writeSSE({
              event: "session",
              data: JSON.stringify({ generationId: generation.generationId }),
            });

            const snapshot = engine.tasks.plan.getGenerationSession({
              generationId: generation.generationId,
            }).generationSession;
            if (snapshot) {
              await clientDump?.write({
                type: "write_sse",
                event: "session",
                snapshot: previewDebugValue(snapshot, 1200),
              });
              await stream.writeSSE({
                event: "session",
                data: JSON.stringify({
                  generationId: generation.generationId,
                  snapshot,
                }),
              });
            }

            try {
              await closed;
            } finally {
              stopHeartbeat();
            }
          });
        } catch (cause) {
          if (
            cause instanceof EngineError &&
            cause.code === ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT
          ) {
            return json(c, planGenerationConflictBody(taskId), 409);
          }
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/plan/generations", cause, "Failed to generate task plan");
        }
      },
    )
    .post(
      "/tasks/:taskId/plan",
      zValidator("param", planPatchParamSchema),
      zValidator("json", planPatchBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const {
            operation,
            nodes,
            edges,
            nodePatches,
            deletedNodeIds,
            reorder,
            summary,
          } = c.req.valid("json");

          const result = await engine.tasks.plan.patch({
            taskId,
            operation,
            nodes: nodes as Array<Record<string, unknown>> | undefined,
            edges: edges as Array<Record<string, unknown>> | undefined,
            nodePatches: nodePatches as
              | Array<{ id: string } & Record<string, unknown>>
              | undefined,
            deletedNodeIds,
            reorder,
            summary,
          });

          return json(c, result, 200);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/plan", cause, "Failed to apply plan patch");
        }
      },
    );
}

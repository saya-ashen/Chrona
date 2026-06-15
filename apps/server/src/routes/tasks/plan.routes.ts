import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { ENGINE_ERROR_CODES, EngineError, type ChronaEngine } from "@chrona/engine";
import { getApiMessages, getPreferredLocale } from "@chrona/i18n";
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


export function createPlansRoutes(engine: ChronaEngine) {
  return new Hono()
    .get(
      "/tasks/:taskId/plan",
      zValidator("param", planStateParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const workBlockId = c.req.query("workBlockId") || null;
          return json(c, await engine.tasks.plan.getState({ taskId, workBlockId }));
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
          const { planId, workspaceId, workBlockId } = c.req.valid("json");

          return json(c, await engine.tasks.plan.accept({ taskId, planId, workspaceId, workBlockId }));
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
          const workBlockId = c.req.query("workBlockId") || null;
          return json(c, engine.tasks.plan.getActiveGeneration({ taskId, workBlockId }));
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
        const workBlockId = c.req.query("workBlockId") || null;
        const active = engine.tasks.plan.getActiveGeneration({ taskId, workBlockId }).generationSession;
        if (!active) {
          return error(c, "No active task plan generation", 404);
        }

        return streamSSE(c, async (stream) => {
          const stopHeartbeat = startSseHeartbeat(stream);
          let resolveClosed: (() => void) | null = null;
          const closed = new Promise<void>((resolve) => {
            resolveClosed = resolve;
          });

          const current = engine.tasks.plan.getActiveGeneration({ taskId, workBlockId }).generationSession;
          if (current && current.generationId === active.generationId) {
            await stream.writeSSE({
              event: "session",
              data: JSON.stringify({ generationId: current.generationId, snapshot: current }),
            });
          }

          let writeQueue = Promise.resolve();
          const writeEvent = (event: import("@chrona/contracts").GeneratePlanSSEEvent) => {
            writeQueue = writeQueue
              .then(() => writePlanGenerationEvent(stream, event))
              .then(() => undefined);

            return writeQueue;
          };

          const subscription = engine.tasks.plan.subscribeToActiveGeneration({
            taskId,
            workBlockId,
            onEvent(event) {
              void writeEvent(event);
              if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
                void writeQueue.finally(() => {
                  resolveClosed?.();
                });
              }
            },
          });

          if (!subscription || subscription.generationId !== active.generationId) {
            await stream.writeSSE({ event: "done", data: "{}" });
            return;
          }

          stream.onAbort(() => {
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
          const workBlockId = c.req.query("workBlockId") || null;
          return json(c, engine.tasks.plan.stopGeneration({ taskId, workBlockId }));
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
        const { forceRefresh, userInstruction, workBlockId } = c.req.valid("json");
        try {
          const requestId = randomUUID();
          logger.info("request.start", {
            requestId,
            feature: "generate_plan",
            taskId,
            streaming: true,
            forceRefresh,
            hasUserInstruction: Boolean(userInstruction?.trim()),
          });

          const generation = engine.tasks.plan.generate({ taskId, workBlockId, forceRefresh, userInstruction });

          void (async () => {
            try {
              for await (const event of generation.events) {
                generation.emit(event);
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
              generation.emit(errorEvent);
            } finally {
              generation.finish();
            }
          })();

          return streamSSE(c, async (stream) => {
            const stopHeartbeat = startSseHeartbeat(stream);

            let resolveClosed: (() => void) | null = null;
            const closed = new Promise<void>((resolve) => {
              resolveClosed = resolve;
            });

            let writeQueue = Promise.resolve();
            const writeEvent = (event: import("@chrona/contracts").GeneratePlanSSEEvent) => {
              writeQueue = writeQueue
                .then(() => writePlanGenerationEvent(stream, event))
                .then(() => undefined);

              return writeQueue;
            };

            const subscription = engine.tasks.plan.subscribeToGeneration({
              generationId: generation.generationId,
              onEvent(event) {
                void writeEvent(event);
                if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
                  void writeQueue.finally(() => {
                    resolveClosed?.();
                  });
                }
              },
            });

            if (!subscription) {
              await stream.writeSSE({
                event: "error",
                data: JSON.stringify({
                  code: "INTERNAL_ERROR",
                  message: "Failed to subscribe to task plan generation session",
                }),
              });
              return;
            }

            stream.onAbort(() => {
              stopHeartbeat();
              subscription.unsubscribe();
              resolveClosed?.();
            });

            await stream.writeSSE({
              event: "session",
              data: JSON.stringify({ generationId: generation.generationId }),
            });

            const snapshot = engine.tasks.plan.getGenerationSession({
              generationId: generation.generationId,
            }).generationSession;
            if (snapshot) {
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
            return json(c, planGenerationConflictBody(taskId, getPreferredLocale(c.req.header("accept-language"))), 409);
          }
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/plan/generations", cause, getApiMessages(getPreferredLocale(c.req.header("accept-language"))).failedGenerateTaskPlan);
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

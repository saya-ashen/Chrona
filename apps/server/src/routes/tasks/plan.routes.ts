import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { ENGINE_ERROR_CODES, EngineError, type ChronaEngine } from "@chrona/engine";
import {
  planStateParamSchema,
  planAcceptParamSchema,
  planAcceptBodySchema,
  planGenerateParamSchema,
  planGenerateBodySchema,
  planGenerateStopParamSchema,
  planMaterializeBodySchema,
  planMaterializeParamSchema,
  planPatchParamSchema,
  planPatchBodySchema,
} from "@chrona/contracts/api";
import { logger, planGenerationConflictBody } from "../helpers";
import { error, internalServerError, json, toHttpError } from "../../lib/http";

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
    .post(
      "/tasks/:taskId/plan/materialize",
      zValidator("param", planMaterializeParamSchema),
      zValidator("json", planMaterializeBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { workspaceId } = c.req.valid("json");
          const result = await engine.tasks.plan.materialize({ taskId, workspaceId });

          const childTasks = result.createdTaskIds.map((id) => ({
            id,
            parentTaskId: result.taskId,
          }));

          return json(c, {
            parentTaskId: result.taskId,
            childTasks,
            planGraph: { nodes: [] },
            updatedNodeIds: result.updatedNodeIds,
          }, 201);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/plan/materialize", cause, "Failed to materialize task plan");
        }
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

          return streamSSE(c, async (stream) => {
            const eventCounts: Record<string, number> = {};
            stream.onAbort(() => generation.finish());

            try {
              for await (const event of generation.events) {
                eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
                logger.info("stream.event", {
                  requestId,
                  feature: "generate_plan",
                  taskId,
                  eventType: event.type,
                });

                switch (event.type) {
                  case "status":
                    await stream.writeSSE({
                      event: "status",
                      data: JSON.stringify({
                        phase: event.phase,
                        message: event.message,
                      }),
                    });
                    break;
                  case "tool_call":
                    await stream.writeSSE({
                      event: "tool_call",
                      data: JSON.stringify({
                        tool: event.tool,
                        input: event.input,
                      }),
                    });
                    break;
                  case "partial":
                    await stream.writeSSE({
                      event: "partial",
                      data: JSON.stringify({ text: event.text }),
                    });
                    break;
                  case "result":
                    await stream.writeSSE({
                      event: "result",
                      data: JSON.stringify(event),
                    });
                    break;
                  case "error":
                    logger.error("request.stream_event_error", {
                      requestId,
                      feature: "generate_plan",
                      taskId,
                      code: event.code,
                      message: event.message,
                      rawText: event.rawText ?? null,
                      diagnostics: event.diagnostics ?? null,
                    });
                    await stream.writeSSE({
                      event: "error",
                      data: JSON.stringify({
                        code: event.code,
                        message: event.message,
                        rawText: event.rawText,
                        diagnostics: event.diagnostics,
                      }),
                    });
                    return;
                  case "done":
                    await stream.writeSSE({ event: "done", data: "{}" });
                    return;
                }
              }

              logger.info("request.done", {
                requestId,
                feature: "generate_plan",
                taskId,
                eventCounts,
              });
            } catch (cause) {
              logger.error("request.stream_error", {
                requestId,
                feature: "generate_plan",
                taskId,
                error: cause instanceof Error ? cause.message : String(cause),
              });
              try {
                await stream.writeSSE({
                  event: "error",
                  data: JSON.stringify({
                    code: "INTERNAL_ERROR",
                    message:
                      cause instanceof Error
                        ? cause.message
                        : "Failed to generate task plan",
                  }),
                });
              } catch {
                /* stream may already be closed */
              }
            } finally {
              generation.finish();
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

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { ENGINE_ERROR_CODES, EngineError, type ChronaEngine } from "@chrona/engine";
import { getApiMessages, getPreferredLocale } from "@chrona/i18n";
import {
  planStateParamSchema,
  planAcceptParamSchema,
  planAcceptBodySchema,
  planGenerateParamSchema,
  planGenerateBodySchema,
  planGenerateStopParamSchema,
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
          const { planId, workspaceId, workBlockId, expectedHeadStateVersion, idempotencyKey } = c.req.valid("json");

          return json(c, await engine.tasks.plan.accept({
            taskId,
            planId,
            workspaceId,
            workBlockId,
            expectedHeadStateVersion,
            idempotencyKey,
          }));
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
      "/tasks/:taskId/plan/generations/stop",
      zValidator("param", planGenerateStopParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const workBlockId = c.req.query("workBlockId") || null;
          return json(c, await engine.tasks.plan.stopGeneration({ taskId, workBlockId }));
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
        const { idempotencyKey, forceRefresh, userInstruction, workBlockId, selectedNodeId } = c.req.valid("json");
        try {
          const requestId = randomUUID();
          logger.info("request.start", {
            requestId,
            feature: "task.plan.generate",
            taskId,
            streaming: true,
            forceRefresh,
            hasUserInstruction: Boolean(userInstruction?.trim()),
          });

          const generation = await engine.tasks.plan.generate({
            taskId,
            workBlockId,
            forceRefresh,
            userInstruction,
            selectedNodeId,
            idempotencyKey,
          });

          void (async () => {
            try {
              for await (const event of generation.events) {
                generation.emit(event);
                if (event.type === "failed") {
                  logger.error("request.stream_event_failed", {
                    requestId,
                    feature: "task.plan.generate",
                    taskId,
                    code: event.code,
                    message: event.message,
                  });
                }
              }
              logger.info("request.done", {
                requestId,
                feature: "task.plan.generate",
                taskId,
                generationId: generation.generationId,
              });
            } catch (cause) {
              logger.error("request.stream_error", {
                requestId,
                feature: "task.plan.generate",
                taskId,
                generationId: generation.generationId,
                error: cause instanceof Error ? cause.message : String(cause),
              });
            } finally {
              generation.finish();
            }
          })();

          return json(c, { generationId: generation.generationId }, 202);
        } catch (cause) {
          if (cause instanceof EngineError && cause.code === ENGINE_ERROR_CODES.PLAN_GENERATION_IN_FLIGHT) {
            return json(c, planGenerationConflictBody(taskId, getPreferredLocale(c.req.header("accept-language"))), 409);
          }
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
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
            expectedHeadStateVersion,
            idempotencyKey,
            nodes,
            edges,
            nodePatches,
            deletedNodeIds,
            summary,
          } = c.req.valid("json");

          const result = await engine.tasks.plan.patch({
            taskId,
            operation,
            expectedHeadStateVersion,
            idempotencyKey,
            nodes: nodes as Array<Record<string, unknown>> | undefined,
            edges: edges as Array<Record<string, unknown>> | undefined,
            nodePatches: nodePatches as Array<{ id: string } & Record<string, unknown>> | undefined,
            deletedNodeIds,
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

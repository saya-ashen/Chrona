import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  taskResultAcceptParamSchema,
  taskResultFollowUpBodySchema,
  taskResultFollowUpParamSchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createTaskResultRoutes(engine: ChronaEngine) {
  return new Hono()
    .get(
      "/tasks/:taskId/result/follow-up",
      zValidator("param", taskResultFollowUpParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.result.getFollowUpState({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
          return internalServerError(
            c,
            "GET /api/tasks/:taskId/result/follow-up",
            cause,
            "Failed to get task result follow-up state",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/result/accept",
      zValidator("param", taskResultAcceptParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.result.accept({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "POST /api/tasks/:taskId/result/accept",
            cause,
            "Failed to accept task result",
          );
        }
      },
    )
    .post(
      "/tasks/:taskId/result/follow-up",
      zValidator("param", taskResultFollowUpParamSchema),
      zValidator("json", taskResultFollowUpBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          return json(
            c,
            await engine.tasks.result.continueFromResult({ taskId, ...body }),
          );
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "POST /api/tasks/:taskId/result/follow-up",
            cause,
            "Failed to continue from task result",
          );
        }
      },
    );
}

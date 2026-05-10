import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  taskDoneParamSchema,
  taskReopenParamSchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createTaskLifecycleRoutes(engine: ChronaEngine) {
  return new Hono()
    .post(
      "/tasks/:taskId/complete",
      zValidator("param", taskDoneParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.lifecycle.complete({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/complete", cause, "Failed to mark task done");
        }
      },
    )
    .post(
      "/tasks/:taskId/reopen",
      zValidator("param", taskReopenParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.lifecycle.reopen({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "POST /api/tasks/:taskId/reopen", cause, "Failed to reopen task");
        }
      },
    );
}

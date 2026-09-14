import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  manualTaskLifecycleBodySchema,
  taskDoneParamSchema,
  taskReopenParamSchema,
} from "@chrona/contracts/api";

import { getTaskWorkspaceId } from "@features/task-workspace/server";
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
      "/tasks/:taskId/manual/complete",
      zValidator("param", taskDoneParamSchema),
      zValidator("json", manualTaskLifecycleBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const workspaceId = await getTaskWorkspaceId(engine, taskId);
          return json(c, await engine.tasks.completeManual({ taskId, workspaceId, ...body }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
          return internalServerError(c, "POST /api/tasks/:taskId/manual/complete", cause, "Failed to complete manual task");
        }
      },
    )
    .post(
      "/tasks/:taskId/manual/reopen",
      zValidator("param", taskReopenParamSchema),
      zValidator("json", manualTaskLifecycleBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const workspaceId = await getTaskWorkspaceId(engine, taskId);
          return json(c, await engine.tasks.reopenManual({ taskId, workspaceId, ...body }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) return error(c, httpError.message, httpError.status);
          return internalServerError(c, "POST /api/tasks/:taskId/manual/reopen", cause, "Failed to reopen manual task");
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

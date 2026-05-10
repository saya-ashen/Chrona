import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ChronaEngine } from "@chrona/engine";
import {
  listTasksQuerySchema,
  createTaskBodySchema,
  taskDetailParamSchema,
  updateTaskParamSchema,
  updateTaskBodySchema,
  deleteTaskParamSchema,
  deleteTaskQuerySchema,
} from "@chrona/contracts/api";

import { error, internalServerError, json, toHttpError } from "../../lib/http";

export function createTasksRoutes(engine: ChronaEngine) {
  return new Hono()
    .get("/tasks", zValidator("query", listTasksQuerySchema), async (c) => {
      try {
        const { workspaceId, status, limit } = c.req.valid("query");

        const result = await engine.tasks.list({
          workspaceId,
          status: status ?? undefined,
          limit,
        });

        return json(c, result);
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(
          c,
          "GET /api/tasks",
          cause,
          "Failed to list tasks",
        );
      }
    })
    .post("/tasks", zValidator("json", createTaskBodySchema), async (c) => {
      try {
        const body = c.req.valid("json");

        const result = await engine.tasks.create({
          workspaceId: body.workspaceId,
          title: body.title,
          description: body.description,
          priority: body.priority,
          executionRuntime: body.executionRuntime,
          executionConfig: body.executionConfig,
        });

        return json(c, result, 201);
      } catch (cause) {
        const httpError = toHttpError(cause);
        if (httpError) {
          return error(c, httpError.message, httpError.status);
        }
        return internalServerError(
          c,
          "POST /api/tasks",
          cause,
          "Failed to create task",
        );
      }
    })
    .get(
      "/tasks/:taskId",
      zValidator("param", taskDetailParamSchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          return json(c, await engine.tasks.getPage({ taskId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "GET /api/tasks/:taskId",
            cause,
            "Failed to get task",
          );
        }
      },
    )
    .patch(
      "/tasks/:taskId",
      zValidator("param", updateTaskParamSchema),
      zValidator("json", updateTaskBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const result = await engine.tasks.update({
            taskId,
            workspaceId: body.workspaceId,
            title: body.title,
            description: body.description,
            priority: body.priority,
            status: body.status,
            executionRuntime: body.executionRuntime,
            executionConfig: body.executionConfig,
          });

          return json(c, result);
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "PATCH /api/tasks/:taskId",
            cause,
            "Failed to update task",
          );
        }
      },
    )
    .delete(
      "/tasks/:taskId",
      zValidator("param", deleteTaskParamSchema),
      zValidator("query", deleteTaskQuerySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const { workspaceId } = c.req.valid("query");
          return json(c, await engine.tasks.delete({ taskId, workspaceId }));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(
            c,
            "DELETE /api/tasks/:taskId",
            cause,
            "Failed to delete task",
          );
        }
      },
    );
}

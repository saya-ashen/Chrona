import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  createTask,
  deleteTask,
  ensureTaskInWorkspace,
  getTaskPage,
  listTasksByWorkspace,
  updateTask,
} from "@chrona/engine";
import {
  listTasksQuerySchema,
  createTaskBodySchema,
  taskDetailParamSchema,
  updateTaskParamSchema,
  updateTaskBodySchema,
  deleteTaskParamSchema,
  deleteTaskQuerySchema,
} from "@chrona/contracts/api";

import { toDateOrNull, ensureValidDateFields } from "./helpers";
import {
  error,
  internalServerError,
  json,
  toHttpError,
} from "../lib/http";

export function createTasksRoutes() {
  return new Hono()
    .get("/tasks", zValidator("query", listTasksQuerySchema), async (c) => {
      try {
        const { workspaceId, status, limit } = c.req.valid("query");

        const result = await listTasksByWorkspace({
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
        return internalServerError(c, "GET /api/tasks", cause, "Failed to list tasks");
      }
    })
    .post("/tasks", zValidator("json", createTaskBodySchema), async (c) => {
      try {
        const body = c.req.valid("json");
        const dueAt = toDateOrNull(body.dueAt);
        const scheduledStartAt = toDateOrNull(body.scheduledStartAt);
        const scheduledEndAt = toDateOrNull(body.scheduledEndAt);

        ensureValidDateFields({ dueAt, scheduledStartAt, scheduledEndAt });

        const result = await createTask({
          workspaceId: body.workspaceId,
          title: body.title,
          description: body.description,
          priority: body.priority,
          dueAt,
          scheduledStartAt,
          scheduledEndAt,
          runtimeAdapterKey: body.runtimeAdapterKey,
          runtimeInput: body.runtimeInput,
          runtimeInputVersion: body.runtimeInputVersion,
          runtimeModel: body.runtimeModel,
          prompt: body.prompt,
          runtimeConfig: body.runtimeConfig,
        });

        return json(c, result, 201);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Failed to create task";
        if (message.includes("No 'Workspace' record") || message.includes("Expected a record")) {
          return error(c, "Workspace not found", 404);
        }
        if (
          message.includes("scheduledEndAt cannot be earlier than scheduledStartAt") ||
          message.includes("must be a valid date string") ||
          message.includes("runtimeConfig must be an object") ||
          message.includes("cannot be empty") ||
          message.includes("parentTaskId must reference a task in the same workspace")
        ) {
          return error(c, message, 400);
        }
        return internalServerError(c, "POST /api/tasks", cause, "Failed to create task");
      }
    })
    .get("/tasks/:taskId/detail", zValidator("param", taskDetailParamSchema), async (c) => {
      try {
        const { taskId } = c.req.valid("param");
        return json(c, await getTaskPage(taskId));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Failed to get task detail";
        return error(c, message, message.includes("not found") ? 404 : 500);
      }
    })
    .patch(
      "/tasks/:taskId",
      zValidator("param", updateTaskParamSchema),
      zValidator("json", updateTaskBodySchema),
      async (c) => {
        try {
          const { taskId } = c.req.valid("param");
          const body = c.req.valid("json");
          const workspaceId = body.workspaceId;
          if (workspaceId) {
            await ensureTaskInWorkspace(taskId, workspaceId);
          }

          const dueAt = toDateOrNull(body.dueAt);
          const scheduledStartAt = toDateOrNull(body.scheduledStartAt);
          const scheduledEndAt = toDateOrNull(body.scheduledEndAt);
          ensureValidDateFields({ dueAt, scheduledStartAt, scheduledEndAt });

          const result = await updateTask({
            taskId,
            title: body.title,
            description: body.description,
            priority: body.priority,
            status: body.status,
            dueAt,
            scheduledStartAt,
            scheduledEndAt,
            runtimeAdapterKey: body.runtimeAdapterKey,
            runtimeInput: body.runtimeInput,
            runtimeInputVersion: body.runtimeInputVersion,
            runtimeModel: body.runtimeModel,
            prompt: body.prompt,
            runtimeConfig: body.runtimeConfig,
          });

          return json(c, result);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to update task";
          if (message.includes("Record to update not found") || message.includes("not found")) {
            return error(c, "Task not found", 404);
          }
          if (
            message.includes("scheduledEndAt cannot be earlier than scheduledStartAt") ||
            message.includes("must be a valid date string") ||
            message.includes("cannot be empty") ||
            message.includes("runtimeConfig must be an object")
          ) {
            return error(c, message, 400);
          }
          return internalServerError(c, "PATCH /api/tasks/:taskId", cause, "Failed to update task");
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
          if (workspaceId) {
            await ensureTaskInWorkspace(taskId, workspaceId);
          }
          return json(c, await deleteTask(taskId));
        } catch (cause) {
          const httpError = toHttpError(cause);
          if (httpError) {
            return error(c, httpError.message, httpError.status);
          }
          return internalServerError(c, "DELETE /api/tasks/:taskId", cause, "Failed to delete task");
        }
      },
    );
}

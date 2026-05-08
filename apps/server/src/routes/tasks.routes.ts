import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import {
  decideScheduleProposal,
  createTask,
  deleteTask,
  ensureTaskInWorkspace,
  getTaskPage,
  listTasksByWorkspace,
  proposeSchedule,
  updateTask,
} from "@chrona/engine";
import type { ScheduleSource } from "@chrona/db/generated/prisma/client";
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
          runtimeInput: body.runtimeInput as Parameters<typeof createTask>[0]["runtimeInput"],
          runtimeInputVersion: body.runtimeInputVersion,
          runtimeModel: body.runtimeModel,
          prompt: body.prompt,
          runtimeConfig: body.runtimeConfig as Parameters<typeof createTask>[0]["runtimeConfig"],
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
    .post("/tasks/:taskId/schedule/proposals", async (c) => {
      try {
        const taskId = c.req.param("taskId");
        const body = await c.req.json();
        return json(
          c,
          await proposeSchedule({
            taskId,
            source: body.source as ScheduleSource,
            proposedBy: body.proposedBy ?? "test",
            summary: body.summary ?? "",
            dueAt: toDateOrNull(body.dueAt),
            scheduledStartAt: toDateOrNull(body.scheduledStartAt),
            scheduledEndAt: toDateOrNull(body.scheduledEndAt),
            assigneeAgentId:
              typeof body.assigneeAgentId === "string" ? body.assigneeAgentId : null,
          }),
          201,
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to create schedule proposal";
        return error(c, message, message.includes("not found") ? 404 : 500);
      }
    })
    .post("/schedule/proposals/decision", async (c) => {
      try {
        const body = await c.req.json();
        const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
        const decision = body.decision;

        if (!proposalId) {
          return error(c, "proposalId is required", 400);
        }

        if (decision !== "Accepted" && decision !== "Rejected") {
          return error(c, 'decision must be "Accepted" or "Rejected"', 400);
        }

        return json(
          c,
          await decideScheduleProposal({
            proposalId,
            decision,
            resolutionNote:
              typeof body.resolutionNote === "string" ? body.resolutionNote : undefined,
          }),
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Failed to resolve schedule proposal";
        return error(
          c,
          message,
          message.includes("not found") || message.includes("No 'ScheduleProposal' record")
            ? 404
            : 400,
        );
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
            status: body.status as Parameters<typeof updateTask>[0]["status"],
            dueAt,
            scheduledStartAt,
            scheduledEndAt,
            runtimeAdapterKey: body.runtimeAdapterKey,
            runtimeInput: body.runtimeInput as Parameters<typeof updateTask>[0]["runtimeInput"],
            runtimeInputVersion: body.runtimeInputVersion,
            runtimeModel: body.runtimeModel,
            prompt: body.prompt,
            runtimeConfig: body.runtimeConfig as Parameters<typeof updateTask>[0]["runtimeConfig"],
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

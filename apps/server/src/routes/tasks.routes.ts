import { Hono } from "hono";

import { TaskStatus } from "@chrona/db/generated/prisma/client";
import { db } from "@chrona/db";
import {
  createTask,
  enrichPlanGraphNodes,
  getAcceptedTaskPlanGraph,
  getLatestTaskPlanGraph,
  getTaskPage,
  isTaskPlanGenerationRunning,
  updateTask,
} from "@chrona/engine";

import {
  VALID_TASK_STATUSES,
  toDateOrNull,
  ensureValidDateFields,
  ensureTaskInWorkspace,
  deleteTaskWithRelations,
} from "./helpers";
import {
  error,
  internalServerError,
  json,
  parseLimit,
  toHttpError,
} from "../lib/http";

export function createTasksRoutes() {
  const api = new Hono();

  api.get("/tasks", async (c) => {
    try {
      const workspaceId = c.req.query("workspaceId");
      if (!workspaceId) {
        return error(c, "workspaceId query parameter is required", 400);
      }

      const status = c.req.query("status");
      const limit = parseLimit(c.req.query("limit"), 50, 200);

      if (status && !VALID_TASK_STATUSES.has(status as TaskStatus)) {
        return error(c, `Invalid status. Valid values: ${[...VALID_TASK_STATUSES].join(", ")}`, 400);
      }

      const tasks = await db.task.findMany({
        where: { workspaceId, ...(status ? { status: status as TaskStatus } : {}) },
        include: { projection: true },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });

      return json(c, { tasks, count: tasks.length });
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "GET /api/tasks", cause, "Failed to list tasks");
    }
  });

  api.post("/tasks", async (c) => {
    try {
      const body = await c.req.json();
      const workspaceId = body.workspaceId;
      const title = body.title;
      const dueAt = toDateOrNull(body.dueAt);
      const scheduledStartAt = toDateOrNull(body.scheduledStartAt);
      const scheduledEndAt = toDateOrNull(body.scheduledEndAt);

      if (!workspaceId) {
        return error(c, "workspaceId is required", 400);
      }

      if (!title || (typeof title === "string" && !title.trim())) {
        return error(c, "title is required", 400);
      }

      ensureValidDateFields({ dueAt, scheduledStartAt, scheduledEndAt });

      const result = await createTask({
        workspaceId,
        title,
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
  });

  api.get("/tasks/:taskId/detail", async (c) => {
    try {
      return json(c, await getTaskPage(c.req.param("taskId")));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to get task detail";
      return error(c, message, message.includes("not found") ? 404 : 500);
    }
  });

  api.patch("/tasks/:taskId", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const body = await c.req.json();
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
      if (workspaceId) {
        await ensureTaskInWorkspace(taskId, workspaceId);
      }

      const dueAt = toDateOrNull(body.dueAt);
      const scheduledStartAt = toDateOrNull(body.scheduledStartAt);
      const scheduledEndAt = toDateOrNull(body.scheduledEndAt);
      ensureValidDateFields({ dueAt, scheduledStartAt, scheduledEndAt });

      if (body.status !== undefined && !VALID_TASK_STATUSES.has(body.status as TaskStatus)) {
        return error(c, `Invalid status. Valid values: ${[...VALID_TASK_STATUSES].join(", ")}`, 400);
      }

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
  });

  api.delete("/tasks/:taskId", async (c) => {
    try {
      const workspaceId = c.req.query("workspaceId");
      if (workspaceId) {
        await ensureTaskInWorkspace(c.req.param("taskId"), workspaceId);
      }
      return json(c, await deleteTaskWithRelations(c.req.param("taskId")));
    } catch (cause) {
      const httpError = toHttpError(cause);
      if (httpError) {
        return error(c, httpError.message, httpError.status);
      }
      return internalServerError(c, "DELETE /api/tasks/:taskId", cause, "Failed to delete task");
    }
  });

  api.get("/tasks/:taskId/plan-state", async (c) => {
    try {
      const taskId = c.req.param("taskId");
      const savedAiPlan = (await getAcceptedTaskPlanGraph(taskId)) ?? (await getLatestTaskPlanGraph(taskId));
      const enrichedPlan = savedAiPlan ? enrichPlanGraphNodes(savedAiPlan.plan) : null;
      const aiPlanGenerationStatus = isTaskPlanGenerationRunning(taskId)
        ? "generating"
        : savedAiPlan?.status === "accepted"
          ? "accepted"
          : savedAiPlan
            ? "waiting_acceptance"
            : "idle";
      return json(c, {
        taskId,
        aiPlanGenerationStatus,
        savedAiPlan: savedAiPlan
          ? {
              id: savedAiPlan.id,
              status: savedAiPlan.status,
              prompt: savedAiPlan.prompt,
              revision: savedAiPlan.revision,
              summary: savedAiPlan.summary,
              updatedAt: savedAiPlan.updatedAt,
              plan: enrichedPlan,
            }
          : null,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to get task plan state";
      return error(c, message, 500);
    }
  });

  return api;
}

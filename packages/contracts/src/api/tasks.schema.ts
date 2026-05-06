import { z } from "zod";
import {
  isoDateOrNull,
  isoDateOptional,
  taskIdParam,
  taskPriorityEnum,
  taskStatusEnum,
  workspaceId,
} from "./common";

// ── GET /tasks ──
export const listTasksQuerySchema = z.object({
  workspaceId: workspaceId,
  status: taskStatusEnum.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 50;
      const n = Number.parseInt(v, 10);
      if (!Number.isFinite(n)) throw new Error("limit must be a valid integer");
      return Math.min(Math.max(n, 1), 200);
    }),
});

// ── POST /tasks ──
export const createTaskBodySchema = z.object({
  workspaceId: workspaceId,
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  priority: taskPriorityEnum.optional(),
  dueAt: isoDateOrNull,
  scheduledStartAt: isoDateOrNull,
  scheduledEndAt: isoDateOrNull,
  runtimeAdapterKey: z.string().optional(),
  runtimeInput: z.unknown().optional(),
  runtimeInputVersion: z.string().optional(),
  runtimeModel: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  runtimeConfig: z.unknown().optional(),
  parentTaskId: z.string().nullable().optional(),
});

// ── PATCH /tasks/:taskId ──
export const updateTaskParamSchema = z.object({
  taskId: taskIdParam,
});
export const updateTaskBodySchema = z.object({
  workspaceId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: taskPriorityEnum.optional(),
  status: taskStatusEnum.optional(),
  dueAt: isoDateOrNull,
  scheduledStartAt: isoDateOrNull,
  scheduledEndAt: isoDateOrNull,
  runtimeAdapterKey: z.string().optional(),
  runtimeInput: z.unknown().optional(),
  runtimeInputVersion: z.string().optional(),
  runtimeModel: z.string().nullable().optional(),
  prompt: z.string().nullable().optional(),
  runtimeConfig: z.unknown().optional(),
});

// ── GET /tasks/:taskId/detail ──
export const taskDetailParamSchema = z.object({
  taskId: taskIdParam,
});

// ── DELETE /tasks/:taskId ──
export const deleteTaskParamSchema = z.object({
  taskId: taskIdParam,
});
export const deleteTaskQuerySchema = z.object({
  workspaceId: z.string().optional(),
});

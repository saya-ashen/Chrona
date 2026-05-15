import { z } from "zod";
import {
  taskIdParam,
  taskPriorityEnum,
  taskStatusEnum,
  workspaceId,
} from "./common";

function executionRuntimeSchema(supportedRuntimes?: readonly string[]) {
  const schema = z.string().trim().min(1, "executionRuntime is required");

  if (!supportedRuntimes) {
    return schema;
  }

  return schema.refine(
    (runtime) => supportedRuntimes.includes(runtime),
    {
      message: `Unsupported executionRuntime. Supported runtimes: ${supportedRuntimes.join(", ")}`,
    },
  );
}

export function createTaskBodySchemaForSupportedRuntimes(
  supportedRuntimes: readonly string[],
) {
  return createTaskBodySchema.extend({
    executionRuntime: executionRuntimeSchema(supportedRuntimes).optional(),
  });
}

export function updateTaskBodySchemaForSupportedRuntimes(
  supportedRuntimes: readonly string[],
) {
  return updateTaskBodySchema.extend({
    executionRuntime: executionRuntimeSchema(supportedRuntimes).optional(),
  });
}

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
  executionRuntime: executionRuntimeSchema().optional(),
  executionConfig: z.record(z.string(), z.unknown()).optional(),
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
  executionRuntime: executionRuntimeSchema().optional(),
  executionConfig: z.record(z.string(), z.unknown()).optional(),
});

// ── GET /tasks/:taskId ──
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

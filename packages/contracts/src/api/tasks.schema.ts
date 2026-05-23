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
  autoExecute: z.boolean().optional(),
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

export const taskNodeActivityParamSchema = z.object({
  taskId: taskIdParam,
  nodeId: z.string().min(1),
});

export const workspaceActivityKindSchema = z.enum([
  "assistant_message",
  "reasoning",
  "tool_started",
  "tool_completed",
  "provider_run",
  "approval",
  "node",
  "task",
  "artifact",
  "schedule",
  "raw",
]);

export const workspaceActivityToneSchema = z.enum(["neutral", "info", "success", "warning", "danger"]);

export const workspaceToolActivitySchema = z.object({
  name: z.string().optional(),
  label: z.string().optional(),
  preview: z.string().optional(),
  inputSummary: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
  state: z.enum(["started", "completed", "failed"]),
});

export const workspaceAssistantActivitySchema = z.object({
  text: z.string(),
  isReasoning: z.boolean(),
  isPartial: z.boolean().optional(),
});

export const workspaceActivityItemSchema = z.object({
  id: z.string().min(1),
  kind: workspaceActivityKindSchema,
  title: z.string().min(1),
  summary: z.string(),
  description: z.string(),
  tone: workspaceActivityToneSchema,
  timestamp: z.string().nullable().optional(),
  sourceNodeId: z.string().optional(),
  sourceNodeTitle: z.string().optional(),
  provider: z.string().optional(),
  runtimeName: z.string().optional(),
  runId: z.string().optional(),
  nativeRunId: z.string().optional(),
  sequence: z.number().optional(),
  rawEventType: z.string().optional(),
  tool: workspaceToolActivitySchema.optional(),
  assistant: workspaceAssistantActivitySchema.optional(),
  raw: z.unknown().optional(),
});

export const workspaceActivityPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 100;
      const limit = Number.parseInt(value, 10);
      if (!Number.isFinite(limit)) throw new Error("limit must be a valid integer");
      return Math.min(Math.max(limit, 1), 3000);
    }),
});

export const workspaceActivityPageSchema = z.object({
  items: z.array(workspaceActivityItemSchema),
  nextCursor: z.string().optional(),
  scope: z.object({
    type: z.enum(["task", "node"]),
    taskId: taskIdParam,
    nodeId: z.string().optional(),
    limit: z.number().int().positive().max(3000),
  }),
});

// ── DELETE /tasks/:taskId ──
export const deleteTaskParamSchema = z.object({
  taskId: taskIdParam,
});
export const deleteTaskQuerySchema = z.object({
  workspaceId: z.string().optional(),
});

import { z } from "zod";
import {
  taskIdParam,
  taskPriorityEnum,
  taskStatusEnum,
  workspaceId,
} from "./common";
import { automationTimingSchema } from "../automation-timing";
import type { TaskStatus } from "../task";

function executionRuntimeSchema(supportedRuntimes?: readonly string[]) {
  const schema = z.string().trim().min(1, "executionRuntime is required");

  if (!supportedRuntimes) {
    return schema;
  }

  return schema.refine((runtime) => supportedRuntimes.includes(runtime), {
    message: `Unsupported executionRuntime. Supported runtimes: ${supportedRuntimes.join(", ")}`,
  });
}

export function createTaskBodySchemaForSupportedRuntimes(
  supportedRuntimes: readonly string[],
) {
  return refineRecurrenceAnchors(
    createTaskBodySchema.extend({
      executionRuntime: executionRuntimeSchema(supportedRuntimes).optional(),
    }),
  );
}

export function updateTaskBodySchemaForSupportedRuntimes(
  supportedRuntimes: readonly string[],
) {
  return updateTaskBodySchema.extend({
    executionRuntime: executionRuntimeSchema(supportedRuntimes).optional(),
  });
}

// ── GET /tasks ──
/** Semantic filter tabs surfaced in the task list UI. */
export const TASK_LIST_FILTERS = [
  "all",
  "needs_me",
  "ready",
  "running",
  "completed",
  "failed",
] as const;

export type TaskListFilter = (typeof TASK_LIST_FILTERS)[number];

/** Maps each semantic filter tab to the concrete task statuses it includes. */
export const TASK_FILTER_STATUS_MAP: Record<
  Exclude<TaskListFilter, "all">,
  readonly TaskStatus[]
> = {
  needs_me: ["WaitingForInput", "WaitingForApproval", "Blocked"],
  ready: ["Ready", "Queued", "Draft"],
  running: ["Running"],
  completed: ["Completed", "Done"],
  failed: ["Failed"],
};

export const TASK_LIST_SORT_FIELDS = [
  "updatedAt",
  "createdAt",
  "dueAt",
  "title",
] as const;

export type TaskListSortField = (typeof TASK_LIST_SORT_FIELDS)[number];

const pageParam = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return 1;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) throw new Error("page must be a valid integer");
    return Math.max(n, 1);
  });

const pageSizeParam = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return 20;
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n))
      throw new Error("pageSize must be a valid integer");
    return Math.min(Math.max(n, 1), 100);
  });

export const listTasksQuerySchema = z.object({
  workspaceId: workspaceId,
  status: taskStatusEnum.optional(),
  filter: z.enum(TASK_LIST_FILTERS).optional(),
  priority: taskPriorityEnum.optional(),
  search: z.string().trim().min(1).optional(),
  sort: z.enum(TASK_LIST_SORT_FIELDS).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  page: pageParam,
  pageSize: pageSizeParam,
});

// Upper bounds on free-text fields. Without a cap, a single request can
// persist an arbitrarily large string (e.g. a 100KB title), a memory/disk
// pressure vector on the local app and an unbounded API contract.
export const TASK_TITLE_MAX = 500;
export const TASK_DESCRIPTION_MAX = 10_000;
export const TASK_RECURRENCE_RULE_MAX = 1_000;

// ── POST /tasks ──
export const createTaskBodySchema = z.object({
  workspaceId: workspaceId,
  title: z.string().min(1, "title is required").max(TASK_TITLE_MAX),
  description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
  priority: taskPriorityEnum.optional(),
  autoPlanGeneration: z.boolean().optional(),
  autoExecute: z.boolean().optional(),
  autoPlanGenerationTiming: automationTimingSchema.optional(),
  autoExecuteTiming: automationTimingSchema.optional(),
  executionRuntime: executionRuntimeSchema().optional(),
  executionConfig: z.record(z.string(), z.unknown()).optional(),
  aiClientId: z.string().trim().min(1).nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  recurrenceRule: z
    .string()
    .trim()
    .min(1)
    .max(TASK_RECURRENCE_RULE_MAX)
    .nullable()
    .optional(),
  recurrenceAnchorStartAt: z.string().datetime().nullable().optional(),
  recurrenceAnchorEndAt: z.string().datetime().nullable().optional(),
});

export const resultFileAccessParamSchema = z.object({ taskId: taskIdParam });

export const resultFileAccessRequestBodySchema = z.object({
  path: z.string().trim().min(1).max(4_096),
});

export const resultFileAccessApproveBodySchema = z.object({
  requestId: z.string().uuid(),
});

/** Recurrence requires both schedule anchors so we can materialize occurrences. */
export function refineRecurrenceAnchors<
  T extends z.ZodType<{
    recurrenceRule?: string | null;
    recurrenceAnchorStartAt?: string | null;
    recurrenceAnchorEndAt?: string | null;
  }>,
>(schema: T) {
  return schema.refine(
    (body) =>
      !body.recurrenceRule ||
      (Boolean(body.recurrenceAnchorStartAt) &&
        Boolean(body.recurrenceAnchorEndAt)),
    {
      message:
        "recurrenceAnchorStartAt and recurrenceAnchorEndAt are required when recurrenceRule is set",
      path: ["recurrenceAnchorStartAt"],
    },
  );
}

// ── PATCH /tasks/:taskId ──
export const updateTaskParamSchema = z.object({
  taskId: taskIdParam,
});
export const updateTaskBodySchema = z.object({
  workspaceId: z.string().optional(),
  title: z.string().min(1).max(TASK_TITLE_MAX).optional(),
  description: z.string().max(TASK_DESCRIPTION_MAX).optional(),
  priority: taskPriorityEnum.optional(),
  autoPlanGeneration: z.boolean().optional(),
  autoExecute: z.boolean().optional(),
  autoPlanGenerationTiming: automationTimingSchema.optional(),
  autoExecuteTiming: automationTimingSchema.optional(),
  status: taskStatusEnum.optional(),
  executionRuntime: executionRuntimeSchema().optional(),
  executionConfig: z.record(z.string(), z.unknown()).optional(),
  aiClientId: z.string().trim().min(1).nullable().optional(),
  recurrenceRule: z
    .string()
    .trim()
    .min(1)
    .max(TASK_RECURRENCE_RULE_MAX)
    .nullable()
    .optional(),
  recurrenceAnchorStartAt: z.string().datetime().nullable().optional(),
  recurrenceAnchorEndAt: z.string().datetime().nullable().optional(),
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

export const workspaceActivityToneSchema = z.enum([
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
]);

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
      if (!Number.isFinite(limit))
        throw new Error("limit must be a valid integer");
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

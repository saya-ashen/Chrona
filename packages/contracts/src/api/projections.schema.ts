import { z } from "zod";
import { checkpointActionKindSchema, executionActionBodySchema } from "./execution.schema";
import { isoDateString, workspaceId } from "./common";

// ── GET /schedule ──
export const scheduleProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /inbox (Action Center projection wire contract) ──
export const actionCenterProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

export const actionCenterItemKindSchema = z.enum([
  "approval",
  "input",
  "schedule_proposal",
  "recovery",
  "blocked",
  "task_due_soon",
  "task_due_now",
  "task_overdue",
  "auto_execution_started",
  "auto_execution_skipped",
  "execution_completed",
  "notification_info",
]);

export const actionCenterItemSchema = z.object({
  id: z.string(),
  kind: actionCenterItemKindSchema,
  actionType: z.string(),
  riskLevel: z.string(),
  sourceTaskTitle: z.string(),
  sourceTaskId: z.string(),
  workspaceId: z.string(),
  currentRunLabel: z.string().nullable(),
  detail: z.string().nullable(),
  summary: z.string(),
  consequence: z.string(),
});

export const actionCenterProjectionSchema = z.array(actionCenterItemSchema);

export type ActionCenterItem = z.infer<typeof actionCenterItemSchema>;
export type ActionCenterProjection = z.infer<typeof actionCenterProjectionSchema>;

// ── GET /dashboard ──
export const dashboardProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

export const dashboardAiBriefGenerateBodySchema = z.object({
  force: z.boolean().optional(),
});

// ── GET /memory ──
export const memoryProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── /work/:taskId command/event transport ──
export const workProjectionParamSchema = z.object({
  taskId: z.string().min(1),
});

const workspaceCommandBaseSchema = z.object({
  idempotencyKey: z.string().min(1),
});

export const workCommandBodySchema = z.union([
  z.object({
    type: z.literal("plan.generate"),
    idempotencyKey: z.string().min(1),
    forceRefresh: z.boolean().optional(),
    workBlockId: z.string().min(1).nullable().optional(),
    userInstruction: z.string().optional().nullable(),
    selectedNodeId: z.string().min(1).nullable().optional(),
    replaceActiveExecution: z.boolean().optional(),
  }),
  workspaceCommandBaseSchema.extend({
    type: z.literal("plan.stop_generation"),
    workBlockId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    type: z.literal("plan.accept"),
    idempotencyKey: z.string().min(1),
    planId: z.string().min(1),
    workBlockId: z.string().min(1).nullable().optional(),
    expectedHeadStateVersion: z.number().int().nonnegative(),
  }),
  executionActionBodySchema.and(workspaceCommandBaseSchema.extend({
    type: z.literal("execution.action"),
  })),
  workspaceCommandBaseSchema.extend({
    type: z.literal("checkpoint.action"),
    checkpointId: z.string().min(1),
    action: checkpointActionKindSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
    workBlockId: z.string().min(1).nullable().optional(),
  }),
]);

// ── GET /workspaces/default ──
// (no input)

// ── GET /workspaces ──
// (no input)

// ── GET /workspaces/:workspaceId/overview ──
export const workspaceOverviewParamSchema = z.object({
  workspaceId: z.string().min(1),
});

export const startWithChronaPreferenceParamSchema = z.object({
  workspaceId: workspaceId,
});

export const startWithChronaPreferenceBodySchema = z.object({
  completedAt: isoDateString.nullable().optional(),
});

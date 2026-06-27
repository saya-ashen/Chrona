import { z } from "zod";
import { checkpointActionKindSchema, executionActionBodySchema } from "./execution.schema";
import { workspaceId } from "./common";

// ── GET /schedule ──
export const scheduleProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /inbox ──
export const inboxProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

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
  idempotencyKey: z.string().min(1).optional(),
});

export const workCommandBodySchema = z.union([
  workspaceCommandBaseSchema.extend({
    type: z.literal("plan.generate"),
    forceRefresh: z.boolean().optional(),
    workBlockId: z.string().min(1).nullable().optional(),
    userInstruction: z.string().optional().nullable(),
  }),
  workspaceCommandBaseSchema.extend({
    type: z.literal("plan.accept"),
    planId: z.string().min(1),
    workBlockId: z.string().min(1).nullable().optional(),
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

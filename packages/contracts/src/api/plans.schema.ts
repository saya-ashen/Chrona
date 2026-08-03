import { z } from "zod";
import { taskIdParam } from "./common";

// ── GET /tasks/:taskId/plan ──
export const planStateParamSchema = z.object({
  taskId: taskIdParam,
});

// ── POST /tasks/:taskId/plan/accept ──
export const planAcceptParamSchema = z.object({
  taskId: taskIdParam,
});
export const planAcceptBodySchema = z.object({
  planId: z.string({ error: "planId is required" }).min(1, "planId is required"),
  expectedHeadStateVersion: z.number({ error: "expectedHeadStateVersion is required" }).int().nonnegative("expectedHeadStateVersion is required"),
  idempotencyKey: z.string({ error: "idempotencyKey is required" }).min(1, "idempotencyKey is required"),
  workBlockId: z.string().min(1).nullable().optional(),
  workspaceId: z.string().optional(),
});

export const planGenerateParamSchema = z.object({
  taskId: taskIdParam,
});
export const planGenerateBodySchema = z.object({
  idempotencyKey: z.string({ error: "idempotencyKey is required" }).min(1, "idempotencyKey is required"),
  forceRefresh: z.boolean().optional(),
  workBlockId: z.string().min(1).nullable().optional(),
  userInstruction: z.string().trim().nullable().optional(),
  selectedNodeId: z.string().min(1).nullable().optional(),
});

// ── POST /tasks/:taskId/plan/generations/stop ──
export const planGenerateStopParamSchema = z.object({
  taskId: taskIdParam,
});

// ── GET /tasks/:taskId/plan/generations/active ──
export const planGenerateActiveParamSchema = z.object({
  taskId: taskIdParam,
});

// ── POST /tasks/:taskId/plan (patch command) ──
export const planPatchParamSchema = z.object({
  taskId: taskIdParam,
});
export const planPatchBodySchema = z
  .object({
    operation: z.enum(["add_node", "update_node", "delete_node", "update_dependencies"]),
    expectedHeadStateVersion: z.number({ error: "expectedHeadStateVersion is required" }).int().nonnegative("expectedHeadStateVersion is required"),
    idempotencyKey: z.string({ error: "idempotencyKey is required" }).min(1, "idempotencyKey is required").max(128),
    nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(128).optional(),
    edges: z.array(z.record(z.string(), z.unknown())).min(1).max(256).optional(),
    nodePatches: z.array(z.object({ id: z.string().min(1) }).passthrough()).min(1).max(128).optional(),
    deletedNodeIds: z.array(z.string().min(1)).min(1).max(128).optional(),
    summary: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payloadFields = {
      add_node: "nodes",
      update_node: "nodePatches",
      delete_node: "deletedNodeIds",
      update_dependencies: "edges",
    } as const;
    const expectedField = payloadFields[value.operation];
    for (const field of Object.values(payloadFields)) {
      const present = value[field] !== undefined;
      if (field === expectedField ? !present : present) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: field === expectedField
            ? `${field} is required for ${value.operation}`
            : `${field} is not allowed for ${value.operation}`,
        });
      }
    }
  });

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
  planId: z.string().min(1, "planId is required"),
  workspaceId: z.string().optional(),
});

// ── POST /tasks/:taskId/plan/generations ──
export const planGenerateParamSchema = z.object({
  taskId: taskIdParam,
});
export const planGenerateBodySchema = z.object({
  forceRefresh: z.boolean().optional(),
  userInstruction: z.string().trim().nullable().optional(),
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
export const planPatchBodySchema = z.object({
  operation: z.string().min(1, "operation is required"),
  operations: z.array(z.string()).optional(),
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  nodePatches: z.array(
    z.object({ id: z.string() }).passthrough(),
  ).optional(),
  deletedNodeIds: z.array(z.string()).optional(),
  reorder: z.array(z.string()).optional(),
  summary: z.string().optional(),
}).passthrough();

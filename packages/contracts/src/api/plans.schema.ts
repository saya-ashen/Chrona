import { z } from "zod";
import { taskIdParam, workspaceId } from "./common";

// ── GET /tasks/:taskId/plan/state ──
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

// ── POST /tasks/:taskId/plan/generate ──
export const planGenerateParamSchema = z.object({
  taskId: taskIdParam,
});
export const planGenerateBodySchema = z.object({
  forceRefresh: z.boolean().optional(),
  planningPrompt: z.string().optional(),
});

// ── POST /tasks/:taskId/plan/generate/stop ──
export const planGenerateStopParamSchema = z.object({
  taskId: taskIdParam,
});

// ── POST /tasks/:taskId/plan/materialize ──
export const planMaterializeParamSchema = z.object({
  taskId: taskIdParam,
});
export const planNodeSchema = z.object({
  id: z.string().optional(),
  type: z.enum(["task", "checkpoint", "condition", "wait"]).optional(),
  title: z.string().optional(),
}).passthrough();
export const planEdgeSchema = z.object({
  fromNodeId: z.string().optional(),
  toNodeId: z.string().optional(),
}).passthrough();
export const planMaterializeBodySchema = z.object({
  workspaceId: z.string().optional(),
  nodes: z.array(planNodeSchema).optional(),
  edges: z.array(planEdgeSchema).optional(),
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

import { z } from "zod";
import { workspaceId } from "./common";

// ── GET /schedule/projection ──
export const scheduleProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /inbox/projection ──
export const inboxProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /memory/projection ──
export const memoryProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /work/:taskId/projection ──
export const workProjectionParamSchema = z.object({
  taskId: z.string().min(1),
});

// ── GET /workspaces/default ──
// (no input)

// ── GET /workspaces ──
// (no input)

// ── GET /workspaces/:workspaceId/overview ──
export const workspaceOverviewParamSchema = z.object({
  workspaceId: z.string().min(1),
});

import { z } from "zod";
import { workspaceId } from "./common";

// ── GET /schedule ──
export const scheduleProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /inbox ──
export const inboxProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /memory ──
export const memoryProjectionQuerySchema = z.object({
  workspaceId: workspaceId,
});

// ── GET /work/:taskId ──
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

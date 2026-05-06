import { z } from "zod";
import { workspaceId } from "./common";

// ── GET /ai/clients ──
// (no input)

// ── POST /ai/clients ──
export const createAiClientSchema = z.object({
  name: z.string().min(1, "name is required"),
  type: z.enum(["openclaw", "llm"], { message: "type must be 'openclaw' or 'llm'" }),
  config: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

// ── POST /ai/clients/test ──
export const testAiClientSchema = z.object({
  type: z.enum(["openclaw", "llm"]),
  config: z.record(z.string(), z.unknown()).optional(),
});

// ── PATCH /ai/clients/:clientId ──
export const updateAiClientParamSchema = z.object({ clientId: z.string().min(1) });
export const updateAiClientBodySchema = z.object({
  name: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

// ── DELETE /ai/clients/:clientId ──
export const deleteAiClientParamSchema = z.object({ clientId: z.string().min(1) });

// ── PUT /ai/clients/:clientId/bindings ──
export const updateAiBindingsParamSchema = z.object({ clientId: z.string().min(1) });
export const updateAiBindingsBodySchema = z.object({
  features: z.array(z.string()),
});

// ── POST /ai/auto-complete ──
export const autoCompleteBodySchema = z.object({
  title: z.string().min(2, "title is required (min 2 characters)"),
  workspaceId: z.string().optional(),
});

// ── POST /ai/task-workspace/chat ──
export const taskWorkspaceChatSchema = z.object({
  taskId: z.string().min(1, "taskId is required"),
  message: z.string().trim().min(1, "message is required"),
  currentTask: z.unknown().optional(),
  currentPlan: z.unknown().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .optional(),
});

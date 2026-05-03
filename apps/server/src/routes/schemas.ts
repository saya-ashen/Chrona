import { z } from "zod";

// ── POST /ai/clients ──
export const createAiClientSchema = z.object({
  name: z.string().min(1, "name is required"),
  type: z.enum(["openclaw", "llm"], { message: "type must be 'openclaw' or 'llm'" }),
  config: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
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

// ── POST /ai/apply-suggestion (changes array format) ──
const changeItemSchema = z.object({
  taskId: z.string().min(1),
  scheduledStartAt: z.string().optional(),
  scheduledEndAt: z.string().optional(),
  priority: z.string().optional(),
});

export const applySuggestionChangesSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  suggestionId: z.string().min(1, "suggestionId is required"),
  changes: z.array(changeItemSchema).min(1, "changes must be a non-empty array"),
});

// ── POST /ai/apply-suggestion (single suggestion format) ──
const suggestionActionSchema = z.object({
  type: z.literal("create_task"),
  title: z.string(),
  description: z.string().optional(),
  priority: z.string().optional(),
  scheduledStartAt: z.string().optional(),
  scheduledEndAt: z.string().optional(),
  estimatedMinutes: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

const suggestionSchema = z.object({
  id: z.string().optional(),
  summary: z.string().optional(),
  action: suggestionActionSchema,
});

export const applySuggestionSingleSchema = z.object({
  workspaceId: z.string().min(1, "workspaceId is required"),
  suggestion: suggestionSchema,
});

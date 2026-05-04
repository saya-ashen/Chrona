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

import { z } from "zod";
import {
  isoDateOrNull,
  isoDateOptional,
  taskIdParam,
  taskPriorityEnum,
  workspaceId,
} from "./common";

// ── POST /tasks/:taskId/run ──
export const runTaskParamSchema = z.object({ taskId: taskIdParam });
export const runTaskBodySchema = z.object({
  prompt: z.string().optional(),
});

// ── POST /tasks/:taskId/retry ──
export const retryTaskParamSchema = z.object({ taskId: taskIdParam });
export const retryTaskBodySchema = z.object({
  prompt: z.string().optional(),
});

// ── POST /tasks/:taskId/input ──
export const taskInputParamSchema = z.object({ taskId: taskIdParam });
export const taskInputBodySchema = z.object({
  inputText: z.string().min(1, "inputText is required"),
});

// ── POST /tasks/:taskId/message ──
export const taskMessageParamSchema = z.object({ taskId: taskIdParam });
export const taskMessageBodySchema = z.object({
  message: z.string().min(1, "message is required"),
});

// ── POST /tasks/:taskId/done ──
export const taskDoneParamSchema = z.object({ taskId: taskIdParam });

// ── POST /tasks/:taskId/reopen ──
export const taskReopenParamSchema = z.object({ taskId: taskIdParam });

// ── POST /tasks/:taskId/result/accept ──
export const taskResultAcceptParamSchema = z.object({ taskId: taskIdParam });

// ── POST /tasks/:taskId/follow-up ──
export const followUpParamSchema = z.object({ taskId: taskIdParam });
export const followUpBodySchema = z.object({
  title: z.string().min(1, "title is required"),
  dueAt: isoDateOrNull,
  priority: taskPriorityEnum.optional(),
});

// ── POST /tasks/:taskId/schedule ──
export const scheduleParamSchema = z.object({ taskId: taskIdParam });
export const scheduleBodySchema = z.object({
  scheduledStartAt: z.string().min(1, "scheduledStartAt is required"),
  scheduledEndAt: z.string().min(1, "scheduledEndAt is required"),
  dueAt: z.string().nullable().optional(),
  scheduleSource: z.enum(["human", "ai", "system"]).optional().default("system"),
});

// ── DELETE /tasks/:taskId/schedule ──
export const clearScheduleParamSchema = z.object({ taskId: taskIdParam });

// ── POST /tasks/:taskId/schedule/proposals ──
export const scheduleProposalParamSchema = z.object({ taskId: taskIdParam });
export const scheduleProposalBodySchema = z.object({
  workspaceId: z.string().optional(),
  source: z.string().optional(),
  proposedBy: z.string().optional(),
  summary: z.string().optional(),
  dueAt: isoDateOrNull,
  scheduledStartAt: isoDateOrNull,
  scheduledEndAt: isoDateOrNull,
  assigneeAgentId: z.string().optional(),
});

// ── POST /schedule/proposals/decision ──
export const scheduleProposalDecisionBodySchema = z.object({
  proposalId: z.string().min(1, "proposalId is required"),
  decision: z.enum(["Accepted", "Rejected"]),
  workspaceId: z.string().optional(),
  resolutionNote: z.string().optional(),
});

// ── POST /approvals/:approvalId/resolve ──
export const resolveApprovalParamSchema = z.object({ approvalId: z.string().min(1) });
export const resolveApprovalBodySchema = z.object({
  decision: z.string().min(1, "decision is required"),
  resolutionNote: z.string().optional(),
  editedContent: z.string().optional(),
});

// ── POST /memories/:memoryId/invalidate ──
export const invalidateMemoryParamSchema = z.object({ memoryId: z.string().min(1) });

// ── POST /tasks/:taskId/assistant/messages ──
export const createAssistantMessageParamSchema = z.object({ taskId: taskIdParam });
export const createAssistantMessageBodySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "content is required"),
  proposal: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ── GET /tasks/:taskId/assistant/messages ──
export const getAssistantMessagesParamSchema = z.object({ taskId: taskIdParam });

// ── PATCH /tasks/:taskId/assistant/messages/:messageId/apply ──
export const applyAssistantMessageParamSchema = z.object({
  taskId: taskIdParam,
  messageId: z.string().min(1),
});

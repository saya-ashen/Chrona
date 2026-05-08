import { z } from "zod";
import {
  isoDateOrNull,
  isoDateOptional,
  taskIdParam,
  taskPriorityEnum,
  workspaceId,
} from "./common";

const nodeIdSchema = z.string().min(1, "nodeId is required");
const sessionIdSchema = z.string().min(1, "sessionId is required");
const workBlockIdSchema = z.string().min(1, "workBlockId is required");
const idempotencyKeySchema = z.string().min(1, "idempotencyKey is required");

export const executionActionParamSchema = z.object({ taskId: taskIdParam });

export const executionActionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start_manual"),
    prompt: z.string().optional(),
    workBlockId: workBlockIdSchema.optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("start_scheduled"),
    workBlockId: workBlockIdSchema.optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("resume_with_input"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema.optional(),
    inputText: z.string().min(1, "inputText is required"),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("resume_with_approval"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema.optional(),
    decision: z.enum(["approve", "reject", "request_changes"]),
    feedback: z.string().optional(),
    editedContent: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("resume_after_unblock"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema.optional(),
    note: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("retry_node"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema,
    prompt: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("cancel_session"),
    sessionId: sessionIdSchema.optional(),
    reason: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
]);

const planEdgeTypeSchema = z.enum([
  "hard_dependency",
  "ordering",
  "context",
  "review_gate",
  "branch",
]);

const nodeDefinitionSchema = z.object({
  title: z.string().min(1, "title is required"),
  objective: z.string().min(1, "objective is required"),
  description: z.string().optional(),
  semantics: z.object({
    type: z.enum(["task", "checkpoint", "condition", "wait"]),
    priority: taskPriorityEnum.optional(),
    mode: z.string().optional(),
    linkedTaskId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  executor: z.string().optional(),
  inputContract: z.record(z.string(), z.unknown()).nullable().optional(),
  outputContract: z.record(z.string(), z.unknown()).nullable().optional(),
  reviewRequired: z.boolean().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const nodeLayerSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    nodeId: nodeIdSchema,
    type: z.literal("definition"),
    createdAt: z.string().min(1),
    createdBy: z.enum(["user", "ai", "system"]),
    reason: z.string().optional(),
    definition: nodeDefinitionSchema,
  }),
  z.object({
    id: z.string().min(1),
    nodeId: nodeIdSchema,
    type: z.literal("invalidation"),
    createdAt: z.string().min(1),
    createdBy: z.enum(["user", "ai", "system"]),
    reason: z.string().min(1, "reason is required"),
    invalidatedByNodeId: z.string().optional(),
    invalidatedByMutationId: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1),
    nodeId: nodeIdSchema,
    type: z.literal("cancellation"),
    createdAt: z.string().min(1),
    createdBy: z.enum(["user", "ai", "system"]),
    reason: z.string().min(1, "reason is required"),
    cancelledAttemptId: z.string().optional(),
  }),
]);

const planEdgeSchema = z.object({
  id: z.string().min(1),
  fromNodeId: nodeIdSchema,
  toNodeId: nodeIdSchema,
  type: planEdgeTypeSchema,
  active: z.boolean(),
  label: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const graphMutationOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add_node"),
    nodeId: nodeIdSchema,
    semanticKey: z.string().min(1, "semanticKey is required"),
    definitionLayer: nodeLayerSchema.and(z.object({ type: z.literal("definition") })),
  }),
  z.object({
    type: z.literal("push_node_layer"),
    nodeId: nodeIdSchema,
    layer: nodeLayerSchema,
  }),
  z.object({
    type: z.literal("add_edge"),
    edge: planEdgeSchema,
  }),
  z.object({
    type: z.literal("remove_edge"),
    edgeId: z.string().min(1, "edgeId is required"),
  }),
  z.object({
    type: z.literal("update_edge"),
    edgeId: z.string().min(1, "edgeId is required"),
    patch: z.object({
      active: z.boolean().optional(),
      label: z.string().optional(),
      type: planEdgeTypeSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("delete_node"),
    nodeId: nodeIdSchema,
  }),
]);

export const planMutationParamSchema = z.object({ taskId: taskIdParam });
export const planMutationBodySchema = z.object({
  expectedGraphId: z.string().optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  reason: z.string().min(1, "reason is required"),
  scope: z.enum(["future_only", "from_node", "entire_graph"]).optional(),
  operations: z.array(graphMutationOperationSchema).min(1, "operations are required"),
});

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

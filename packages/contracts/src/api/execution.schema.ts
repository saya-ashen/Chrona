import { z } from "zod";
import { isoDateOrNull, taskIdParam, taskPriorityEnum } from "./common";
import { nodeDeliverableSchema, resultContributionSchema, resultEvidenceSchema } from "./result.schema";

const nodeIdSchema = z.string().min(1, "nodeId is required");
const sessionIdSchema = z.string().min(1, "sessionId is required");
const workBlockIdSchema = z.string().min(1, "workBlockId is required");
const idempotencyKeySchema = z.string().min(1, "idempotencyKey is required");
const nodeActionFormFieldSchema = z
  .object({
    name: z.string().min(1, "field name is required"),
    label: z.string().min(1, "field label is required"),
    type: z.enum(["text", "textarea", "select"]).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1)).optional(),
  })
  .strict();
const nodeActionFormSchema = z
  .object({
    instructions: z.string().min(1, "instructions are required"),
    submitLabel: z.string().min(1).optional(),
    inputFields: z
      .array(nodeActionFormFieldSchema)
      .min(1, "at least one input field is required"),
  })
  .strict();


export const providerApprovalChoiceSchema = z.enum([
  "approve_once",
  "approve_session",
  "approve_always",
  "deny",
]);

export const providerApprovalRiskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
  "unknown",
]);

export const providerApprovalReadModelSchema = z
  .object({
    id: z.string().min(1),
    taskId: taskIdParam,
    workBlockId: z.string().min(1).nullable().optional(),
    planId: z.string().min(1),
    planRunId: z.string().min(1),
    nodeId: z.string().min(1).nullable().optional(),
    nodeTitle: z.string().min(1).nullable().optional(),
    provider: z.string().min(1),
    runtimeName: z.string().min(1).nullable().optional(),
    nativeRunId: z.string().min(1).nullable().optional(),
    kind: z.string().min(1),
    providerKind: z.string().min(1).nullable().optional(),
    title: z.string().min(1),
    summary: z.string().min(1),
    description: z.string().min(1).nullable().optional(),
    riskLevel: providerApprovalRiskLevelSchema,
    subject: z.unknown().optional(),
    choices: z.array(providerApprovalChoiceSchema).min(1),
    scopePolicy: z.unknown().optional(),
    status: z.string().min(1),
    requestedAt: z.string().min(1),
    resolvedAt: z.string().min(1).nullable().optional(),
    choice: providerApprovalChoiceSchema.nullable().optional(),
    resolveAll: z.boolean().optional(),
  })
  .strict();

export const providerApprovalListQuerySchema = z
  .object({
    status: z
      .enum([
        "pending",
        "approved",
        "denied",
        "expired",
        "superseded",
        "failed",
        "all",
      ])
      .optional(),
  })
  .strict();

export const providerApprovalListResponseSchema = z
  .object({
    approvals: z.array(providerApprovalReadModelSchema),
  })
  .strict();

export const providerApprovalResolveParamSchema = z.object({
  taskId: taskIdParam,
  approvalId: z.string().min(1, "approvalId is required"),
});

export const providerApprovalResolveBodySchema = z
  .object({
    choice: providerApprovalChoiceSchema,
    resolveAll: z.boolean().optional(),
    note: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

export const providerApprovalResolveResponseSchema = z
  .object({
    approval: providerApprovalReadModelSchema,
    provider: z.string().min(1),
    runId: z.string().min(1),
    choice: providerApprovalChoiceSchema,
    resolved: z.number().int().nonnegative(),
    status: z.enum(["resolved", "not_pending", "not_active"]),
  })
  .strict();
export const executionActionParamSchema = z.object({ taskId: taskIdParam });

export const executionActionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start_manual"),
    prompt: z.string().optional(),
    workBlockId: workBlockIdSchema.optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("restart_from_beginning"),
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
    inputFields: z
      .record(z.string(), z.string())
      .refine(
        (value) => Object.values(value).some((item) => item.trim()),
        "inputFields must include at least one value",
      ),
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
    action: z.literal("complete_manual_node"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema.optional(),
    summary: z.string().optional(),
    output: z.unknown().optional(),
    deliverables: z.array(nodeDeliverableSchema).optional(),
    findings: z.array(resultContributionSchema).optional(),
    decisions: z.array(resultContributionSchema).optional(),
    caveats: z.array(resultContributionSchema).optional(),
    nextActions: z.array(resultContributionSchema).optional(),
    evidenceItems: z.array(resultEvidenceSchema).optional(),
    terminalKind: z
      .enum(["task", "condition", "checkpoint", "wait"])
      .optional(),
    branchRef: z.string().min(1).optional(),
    decision: z
      .enum(["approved", "rejected", "needs_input", "completed"])
      .optional(),
    feedback: z.string().optional(),
    prompt: z.string().optional(),
    selectedBranch: z
      .object({
        label: z.string().min(1),
        nextNodeId: z.string().min(1),
        source: z.enum(["user", "ai", "system", "default"]),
      })
      .optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("block_current_node"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema.optional(),
    reason: z.string().min(1, "reason is required"),
    actionForm: nodeActionFormSchema.optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("fail_current_node"),
    sessionId: sessionIdSchema.optional(),
    nodeId: nodeIdSchema.optional(),
    error: z.string().min(1, "error is required"),
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
    action: z.literal("pause_session"),
    sessionId: sessionIdSchema.optional(),
    reason: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  z.object({
    action: z.literal("cancel_session"),
    sessionId: sessionIdSchema.optional(),
    reason: z.string().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
]);

export const checkpointActionParamSchema = z.object({
  taskId: taskIdParam,
  checkpointId: z.string().min(1, "checkpointId is required"),
});

export const checkpointActionKindSchema = z.enum([
  "submit_input",
  "approve_result",
  "reject_result",
  "request_changes",
  "request_replan",
  "accept_replan",
  "reject_replan",
  "retry_node",
  "resume_after_unblock",
  "mark_node_completed",
  "mark_node_skipped",
  "cancel_session",
  "fail_task",
]);

export const checkpointActionBodySchema = z
  .object({
    action: checkpointActionKindSchema,
    payload: z.unknown().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict();

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
    definitionLayer: nodeLayerSchema.and(
      z.object({ type: z.literal("definition") }),
    ),
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
  operations: z
    .array(graphMutationOperationSchema)
    .min(1, "operations are required"),
});

// ── POST /tasks/:taskId/complete ──
export const taskDoneParamSchema = z.object({ taskId: taskIdParam });

// ── POST /tasks/:taskId/reopen ──
export const taskReopenParamSchema = z.object({ taskId: taskIdParam });

// ── POST /tasks/:taskId/result/accept ──
export const taskResultAcceptParamSchema = z.object({ taskId: taskIdParam });

export const taskResultFollowUpParamSchema = z.object({ taskId: taskIdParam });

const taskResultContinuationRequestIdSchema = z.string().uuid();

export const taskResultFollowUpBodySchema = z.discriminatedUnion("intent", [
  z.object({
    requestId: taskResultContinuationRequestIdSchema,
    intent: z.literal("create_task"),
    instruction: z.string().trim().min(1).max(10_000),
    sessionStrategy: z
      .enum(["handoff_compact", "fresh_with_result"])
      .default("handoff_compact"),
  }).strict(),
  z.object({
    requestId: taskResultContinuationRequestIdSchema,
    intent: z.literal("ask"),
    instruction: z.string().trim().min(1).max(10_000),
  }).strict(),
]);

export const taskResultFollowUpEntrySchema = z.object({
  id: z.string(),
  requestId: z.string(),
  acceptedRunId: z.string(),
  intent: z.enum(["ask", "create_task"]),
  status: z.enum(["pending", "completed", "failed"]),
  instruction: z.string(),
  answer: z.string().nullable().optional(),
  answerSource: z.string().nullable().optional(),
  contextSource: z
    .enum(["source_session", "accepted_result_fallback"])
    .nullable()
    .optional(),
  sessionStrategy: z
    .enum(["handoff_compact", "fresh_with_result"])
    .nullable()
    .optional(),
  createdTask: z
    .object({ id: z.string(), title: z.string() })
    .nullable()
    .optional(),
  cache: z
    .object({
      readInputTokens: z.number().int().nonnegative().nullable(),
      creationInputTokens: z.number().int().nonnegative().nullable(),
    })
    .optional(),
  error: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
}).strict();

export const taskResultFollowUpStateSchema = z.object({
  acceptedRunId: z.string(),
  acceptedAt: z.string().datetime(),
  sourceSession: z.object({
    available: z.boolean(),
    provider: z.string(),
    health: z.enum(["fresh", "moderate", "high", "compacted", "unavailable", "unknown"]),
    supportsFork: z.boolean(),
    supportsResume: z.boolean(),
    supportsHandoff: z.boolean(),
  }).strict(),
  entries: z.array(taskResultFollowUpEntrySchema),
}).strict();

// ── PUT /tasks/:taskId/schedule ──
export const scheduleParamSchema = z.object({ taskId: taskIdParam });
export const scheduleBodySchema = z.object({
  scheduledStartAt: z.string().min(1, "scheduledStartAt is required"),
  scheduledEndAt: z.string().min(1, "scheduledEndAt is required"),
  dueAt: z.string().nullable().optional(),
  scheduleSource: z
    .enum(["human", "ai", "system"])
    .optional()
    .default("system"),
});

// ── DELETE /tasks/:taskId/schedule ──
export const clearScheduleParamSchema = z.object({ taskId: taskIdParam });

// ── PUT /work-blocks/:workBlockId/schedule ──
export const workBlockScheduleParamSchema = z.object({
  workBlockId: workBlockIdSchema,
});
export const workBlockScheduleBodySchema = z.object({
  scheduledStartAt: z.string().min(1, "scheduledStartAt is required"),
  scheduledEndAt: z.string().min(1, "scheduledEndAt is required"),
});

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
});

// ── POST /tasks/schedule-proposals/decision ──
export const scheduleProposalDecisionBodySchema = z.object({
  proposalId: z.string().min(1, "proposalId is required"),
  decision: z.enum(["Accepted", "Rejected"]),
  workspaceId: z.string().optional(),
  resolutionNote: z.string().optional(),
});

// ── POST /approvals/:approvalId/resolve ──
export const resolveApprovalParamSchema = z.object({
  approvalId: z.string().min(1),
});
export const resolveApprovalBodySchema = z.object({
  decision: z.string().min(1, "decision is required"),
  resolutionNote: z.string().optional(),
  editedContent: z.string().optional(),
});

// ── POST /memories/:memoryId/invalidate ──
export const invalidateMemoryParamSchema = z.object({
  memoryId: z.string().min(1),
});

// ── POST /tasks/:taskId/assistant/messages ──
export const createAssistantMessageParamSchema = z.object({
  taskId: taskIdParam,
});
export const createAssistantMessageBodySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "content is required"),
  proposal: z.record(z.string(), z.unknown()).nullable().optional(),
});

// ── GET /tasks/:taskId/assistant/messages ──
export const getAssistantMessagesParamSchema = z.object({
  taskId: taskIdParam,
});

// ── PATCH /tasks/:taskId/assistant/messages/:messageId/apply ──
export const applyAssistantMessageParamSchema = z.object({
  taskId: taskIdParam,
  messageId: z.string().min(1),
});

import { z } from "zod";
import {
  createTaskBodySchema,
  updateTaskBodySchema,
} from "./tasks.schema";
import {
  executionActionBodySchema,
  planMutationBodySchema,
  scheduleBodySchema,
  scheduleProposalBodySchema,
} from "./execution.schema";
import { nodeDeliverableSchema, resultContributionSchema, resultEvidenceSchema } from "./result.schema";
const MAX_MCP_STRING_LENGTH = 16_000;
const MAX_MCP_JSON_DEPTH = 8;
const MAX_MCP_JSON_ELEMENTS = 1_000;

function hasBoundedJsonShape(value: unknown, depth = 0, state = { elements: 0 }): boolean {
  if (depth > MAX_MCP_JSON_DEPTH || ++state.elements > MAX_MCP_JSON_ELEMENTS) return false;
  if (typeof value === "string") return value.length <= MAX_MCP_STRING_LENGTH;
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.every((entry) => hasBoundedJsonShape(entry, depth + 1, state));
  if (typeof value !== "object") return false;
  return Object.entries(value).every(([key, entry]) =>
    key.length <= 128 && hasBoundedJsonShape(entry, depth + 1, state)
  );
}

const boundedJsonValueSchema = z.unknown().superRefine((value, ctx) => {
  if (!hasBoundedJsonShape(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `JSON values must be at most ${MAX_MCP_JSON_DEPTH} levels deep with at most ${MAX_MCP_JSON_ELEMENTS} elements.`,
    });
  }
});

const boundedRecordSchema = z.record(z.string().max(128), boundedJsonValueSchema).superRefine((value, ctx) => {
  if (Object.keys(value).length > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Record values must contain at most 100 keys.",
    });
  }
});

export const chronaToolNames = [
  "chrona.task.read",
  "chrona.task.create",
  "chrona.task.update",
  "chrona.goal.results.read",
  "chrona.plan.read",
  "chrona.plan.mutate",
  "chrona.schedule.read",
  "chrona.schedule.propose",
  "chrona.schedule.set",
  "chrona.schedule.clear",
  "chrona.execution.read",
  "chrona.execution.dispatch",
  "chrona.node.read",
  "chrona.node.complete",
  "chrona.node.condition_select",
  "chrona.node.block",
  "chrona.node.request_input",
  "chrona.node.fail",
  "chrona.node.wait_complete",
] as const;

export const chronaToolNameSchema = z.enum(chronaToolNames);

export const chronaToolStatusSchema = z.enum(["accepted", "rejected", "noop"]);

export const chronaToolReasonCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "STALE_STATE",
  "INVALID_TRANSITION",
  "INTERNAL_ERROR",
  "CONFLICT",
  "DUPLICATE_OPERATION",
  "PROVIDER_UNSUPPORTED",
]);

export const chronaToolIdempotencyStatusSchema = z.enum([
  "new",
  "replayed",
  "not_applicable",
]);

export const chronaToolExpectedStateSchema = z.object({
  taskStatus: z.string().max(256).optional(),
  taskRevision: z.number().int().nonnegative().optional(),
  planGraphId: z.string().max(256).optional(),
  planRevision: z.number().int().nonnegative().optional(),
  scheduleStatus: z.string().max(256).optional(),
  executionStatus: z.string().max(256).optional(),
  executionSessionId: z.string().max(256).optional(),
  nodeId: z.string().max(256).optional(),
}).catchall(boundedJsonValueSchema);

export const chronaToolEvidenceSchema = z.object({
  providerText: z.string().max(MAX_MCP_STRING_LENGTH).optional(),
  toolCalls: z.array(boundedRecordSchema).max(32).optional(),
  toolOutputs: z.array(boundedRecordSchema).max(32).optional(),
  structuredOutput: boundedJsonValueSchema.optional(),
}).catchall(boundedJsonValueSchema);

export const chronaToolContextSchema = z.object({
  workspaceId: z.string().min(1).max(256).optional(),
  taskId: z.string().min(1).max(256).optional(),
  sessionId: z.string().min(1).max(256).optional(),
  actorType: z.enum(["agent", "human", "system"]).optional().default("agent"),
  actorId: z.string().min(1).max(256).optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
  expectedState: chronaToolExpectedStateSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  evidence: chronaToolEvidenceSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.taskId || value.sessionId) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["sessionId"],
    message: "sessionId or resolved taskId is required",
  });
});

const readPayloadSchema = z.object({}).passthrough().optional().default({});
const publicReadPayloadSchema = z.object({}).passthrough();
export const nodeReadPayloadSchema = z.object({
  ref: z.string().trim().regex(/^N\d{8}-\d{2,}$/).optional(),
  offset: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(1).max(12_000).default(12_000),
}).strict();
export const goalResultsReadPayloadSchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  ref: z.string().trim().regex(/^(?:GR|GA)[0-9A-F]{12}$/).optional(),
  offset: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(1).max(12_000).default(12_000),
  limit: z.number().int().min(1).max(10).default(5),
  cursor: z.string().trim().regex(/^(?:GR|GA)[0-9A-F]{12}$/).optional(),
}).strict();
const nodeEvidencePayloadSchema = boundedRecordSchema.optional();



export const taskCompletePayloadSchema = z.object({
  summary: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  deliverables: z.array(nodeDeliverableSchema).max(100).optional(),
  findings: z.array(resultContributionSchema).max(100).optional(),
  decisions: z.array(resultContributionSchema).max(100).optional(),
  caveats: z.array(resultContributionSchema).max(100).optional(),
  nextActions: z.array(resultContributionSchema).max(100).optional(),
  evidenceItems: z.array(resultEvidenceSchema).max(100).optional(),
}).strict();

export const conditionSelectPayloadSchema = z.object({
  nodeId: z.string().min(1).max(256),
  branchRef: z.string().min(1).max(256),
  summary: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  evidence: nodeEvidencePayloadSchema,
}).strict();

const interactionOptionSchema = z.object({
  value: z.string().min(1).max(256),
  label: z.string().min(1).max(512),
  description: z.string().min(1).max(4_000).optional(),
  recommended: z.boolean().optional(),
}).strict();

const textInteractionFieldSchema = z.object({
  kind: z.literal("text"),
  name: z.string().min(1).max(128),
  label: z.string().min(1).max(512),
  description: z.string().min(1).max(4_000).optional(),
  multiline: z.boolean().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().max(4_000).optional(),
  defaultValue: z.string().max(4_000).optional(),
}).strict();

const choiceInteractionFieldSchema = z.object({
  kind: z.literal("choice"),
  name: z.string().min(1).max(128),
  label: z.string().min(1).max(512),
  description: z.string().min(1).max(4_000).optional(),
  selection: z.enum(["single", "multiple"]),
  options: z.array(interactionOptionSchema).min(1).max(100),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string().max(256), z.array(z.string().max(256)).max(100)]).optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().max(100).optional(),
}).strict();

const booleanInteractionFieldSchema = z.object({
  kind: z.literal("boolean"),
  name: z.string().min(1).max(128),
  label: z.string().min(1).max(512),
  description: z.string().min(1).max(4_000).optional(),
  defaultValue: z.boolean().optional(),
}).strict();

export const interactionFieldSchema = z.discriminatedUnion("kind", [
  textInteractionFieldSchema,
  choiceInteractionFieldSchema,
  booleanInteractionFieldSchema,
]);

export const requestInputPayloadSchema = z.object({
  title: z.string().min(1).max(512),
  instructions: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  fields: z.array(interactionFieldSchema).min(1).max(100),
  submitLabel: z.string().min(1).max(256).optional(),
  relatedOutputElementIds: z.array(z.string().min(1).max(256)).max(100).optional(),
  evidence: nodeEvidencePayloadSchema,
}).strict();

const blockActionFormFieldSchema = z.object({
  name: z.string().min(1).max(128),
  label: z.string().min(1).max(512),
  type: z.enum(["text", "textarea", "select"]).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1).max(256)).max(100).optional(),
}).strict();

const blockActionFormSchema = z.object({
  instructions: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  submitLabel: z.string().min(1).max(256).optional(),
  inputFields: z.array(blockActionFormFieldSchema).min(1).max(100),
}).strict();

export const blockPayloadSchema = z.object({
  reason: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  actionForm: blockActionFormSchema,
  retryable: z.boolean().optional(),
  evidence: nodeEvidencePayloadSchema,
}).strict();

export const failPayloadSchema = z.object({
  error: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  retryable: z.boolean().optional(),
  diagnostics: boundedJsonValueSchema.optional(),
  evidence: nodeEvidencePayloadSchema,
}).strict();

export const waitCompletePayloadSchema = z.object({
  summary: z.string().min(1).max(MAX_MCP_STRING_LENGTH),
  evidence: nodeEvidencePayloadSchema,
}).strict();


export const chronaToolPayloadSchemas = {
  "chrona.task.read": readPayloadSchema,
  "chrona.task.create": createTaskBodySchema.omit({ workspaceId: true }),
  "chrona.goal.results.read": goalResultsReadPayloadSchema,
  "chrona.task.update": updateTaskBodySchema.omit({ workspaceId: true }),
  "chrona.plan.read": readPayloadSchema,
  "chrona.plan.mutate": planMutationBodySchema,
  "chrona.schedule.read": readPayloadSchema,
  "chrona.schedule.propose": scheduleProposalBodySchema.omit({ workspaceId: true }),
  "chrona.schedule.set": scheduleBodySchema,
  "chrona.schedule.clear": readPayloadSchema,
  "chrona.execution.read": readPayloadSchema,
  "chrona.execution.dispatch": executionActionBodySchema,
  "chrona.node.read": nodeReadPayloadSchema,
  "chrona.node.complete": taskCompletePayloadSchema,
  "chrona.node.condition_select": conditionSelectPayloadSchema,
  "chrona.node.block": blockPayloadSchema,
  "chrona.node.request_input": requestInputPayloadSchema,
  "chrona.node.fail": failPayloadSchema,
  "chrona.node.wait_complete": waitCompletePayloadSchema,
} as const;

export const chronaPublicToolPayloadSchemas = {
  ...chronaToolPayloadSchemas,
  "chrona.task.read": publicReadPayloadSchema,
  "chrona.goal.results.read": goalResultsReadPayloadSchema,
  "chrona.plan.read": publicReadPayloadSchema,
  "chrona.schedule.read": publicReadPayloadSchema,
  "chrona.execution.read": publicReadPayloadSchema,
  "chrona.node.read": nodeReadPayloadSchema,
  "chrona.node.complete": taskCompletePayloadSchema,
  "chrona.node.condition_select": conditionSelectPayloadSchema.omit({ evidence: true }).strict(),
  "chrona.node.block": blockPayloadSchema.omit({ evidence: true }).strict(),
  "chrona.node.request_input": requestInputPayloadSchema.omit({ evidence: true }).strict(),
  "chrona.node.fail": failPayloadSchema.omit({ evidence: true }).strict(),
  "chrona.node.wait_complete": waitCompletePayloadSchema.omit({ evidence: true }).strict(),
} as const;

export const agentControlActionKindSchema = z.enum([
  "task_read",
  "plan_read",
  "complete",
  "condition_select",
  "wait_complete",
  "block",
  "request_input",
  "fail",
]);

export const agentControlActionPayloadSchemas = {
  task_read: chronaPublicToolPayloadSchemas["chrona.task.read"],
  plan_read: chronaPublicToolPayloadSchemas["chrona.plan.read"],
  complete: chronaPublicToolPayloadSchemas["chrona.node.complete"],
  condition_select: chronaPublicToolPayloadSchemas["chrona.node.condition_select"],
  wait_complete: chronaPublicToolPayloadSchemas["chrona.node.wait_complete"],
  block: chronaPublicToolPayloadSchemas["chrona.node.block"],
  request_input: chronaPublicToolPayloadSchemas["chrona.node.request_input"],
  fail: chronaPublicToolPayloadSchemas["chrona.node.fail"],
} as const;

export const agentControlActionBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task_read"), payload: agentControlActionPayloadSchemas.task_read }).strict(),
  z.object({ kind: z.literal("plan_read"), payload: agentControlActionPayloadSchemas.plan_read }).strict(),
  z.object({ kind: z.literal("complete"), payload: agentControlActionPayloadSchemas.complete }).strict(),
  z.object({ kind: z.literal("condition_select"), payload: agentControlActionPayloadSchemas.condition_select }).strict(),
  z.object({ kind: z.literal("wait_complete"), payload: agentControlActionPayloadSchemas.wait_complete }).strict(),
  z.object({ kind: z.literal("block"), payload: agentControlActionPayloadSchemas.block }).strict(),
  z.object({ kind: z.literal("request_input"), payload: agentControlActionPayloadSchemas.request_input }).strict(),
  z.object({ kind: z.literal("fail"), payload: agentControlActionPayloadSchemas.fail }).strict(),
]);

/**
 * Contracts for agent-operated MCP task tools. Provider text, tool traces, and
 * structured output belong in `input.evidence`; Chrona services remain the only
 * authority for accepted lifecycle state.
 */

export const chronaToolInputSchema = chronaToolContextSchema.extend({
  payload: z.unknown().optional(),
});

export function chronaToolInputSchemaFor(toolName: ChronaToolName) {
  return chronaToolContextSchema.extend({
    payload: chronaToolPayloadSchemas[toolName],
  });
}

export const chronaToolOperationSchema = z.object({
  toolName: chronaToolNameSchema,
  input: chronaToolInputSchema,
});

export const chronaToolAffectedSchema = z.object({
  workspaceId: z.string().optional(),
  taskId: z.string().optional(),
  planId: z.string().optional(),
  executionSessionId: z.string().optional(),
}).passthrough();

export const chronaToolRecoverySchema = z.object({
  nextTool: chronaToolNameSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const chronaToolResultSchema = z.object({
  operationId: z.string().min(1),
  toolName: chronaToolNameSchema,
  status: chronaToolStatusSchema,
  reasonCode: chronaToolReasonCodeSchema.nullable(),
  message: z.string().min(1),
  affected: chronaToolAffectedSchema,
  state: z.record(z.string(), z.unknown()),
  idempotency: chronaToolIdempotencyStatusSchema,
  auditRef: z.string().nullable(),
  recovery: chronaToolRecoverySchema.nullable(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  completedAt: z.string().min(1),
});

export const chronaToolRegistryItemSchema = z.object({
  name: chronaToolNameSchema,
  mutates: z.boolean(),
  description: z.string(),
});

export const chronaToolRegistrySchema = z.object({
  tools: z.array(chronaToolRegistryItemSchema),
});

export type ChronaToolName = z.infer<typeof chronaToolNameSchema>;
export type ChronaToolReasonCode = z.infer<typeof chronaToolReasonCodeSchema>;
export type ChronaToolIdempotencyStatus = z.infer<typeof chronaToolIdempotencyStatusSchema>;
export type ChronaToolExpectedState = z.infer<typeof chronaToolExpectedStateSchema>;
export type ChronaToolEvidence = z.infer<typeof chronaToolEvidenceSchema>;
export type ChronaToolInput = z.infer<typeof chronaToolInputSchema>;
export type ChronaToolOperation = z.infer<typeof chronaToolOperationSchema>;
export type ChronaToolResult = z.infer<typeof chronaToolResultSchema>;
export type ChronaToolRecovery = z.infer<typeof chronaToolRecoverySchema>;
export type ChronaToolRegistry = z.infer<typeof chronaToolRegistrySchema>;
export type AgentControlActionKind = z.infer<typeof agentControlActionKindSchema>;
export type AgentControlActionBody = z.infer<typeof agentControlActionBodySchema>;

export function isChronaToolMutating(toolName: ChronaToolName) {
  return !toolName.endsWith(".read");
}

export function parseChronaToolPayload(toolName: ChronaToolName, payload: unknown) {
  return chronaToolPayloadSchemas[toolName].parse(payload ?? {});
}

import { z } from "zod";
import { planGenerateToolPayloadSchema } from "../plan-generate-tool";
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

export const chronaToolNames = [
  "chrona.task.read",
  "chrona.task.create",
  "chrona.task.update",
  "chrona.goal.results.read",
  "chrona.plan.read",
  "chrona.plan.generate",
  "chrona.plan.mutate",
  "chrona.schedule.read",
  "chrona.schedule.propose",
  "chrona.schedule.set",
  "chrona.schedule.clear",
  "chrona.execution.read",
  "chrona.execution.dispatch",
  "chrona.node.read",
  "chrona.dashboard.brief",
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
  taskStatus: z.string().optional(),
  taskRevision: z.number().int().nonnegative().optional(),
  planGraphId: z.string().optional(),
  planRevision: z.number().int().nonnegative().optional(),
  scheduleStatus: z.string().optional(),
  executionStatus: z.string().optional(),
  executionSessionId: z.string().optional(),
  nodeId: z.string().optional(),
}).passthrough();

export const chronaToolEvidenceSchema = z.object({
  providerText: z.string().optional(),
  toolCalls: z.array(z.record(z.string(), z.unknown())).optional(),
  toolOutputs: z.array(z.record(z.string(), z.unknown())).optional(),
  structuredOutput: z.unknown().optional(),
}).passthrough();

export const chronaToolContextSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  actorType: z.enum(["agent", "human", "system"]).optional().default("agent"),
  actorId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  expectedState: chronaToolExpectedStateSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  evidence: chronaToolEvidenceSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.taskId || value.sessionId) {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["sessionId"],
    message: "sessionId or resolved taskId is required",
  });
});

const readPayloadSchema = z.object({}).passthrough().optional().default({});
const publicReadPayloadSchema = z.object({}).passthrough();
export const goalResultsReadPayloadSchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(10).default(5),
  cursor: z.string().trim().regex(/^(?:GR|GA)[0-9A-F]{12}$/).optional(),
}).strict();
const nodeEvidencePayloadSchema = z.record(z.string(), z.unknown()).optional();



export const taskCompletePayloadSchema = z.object({
  summary: z.string().min(1),
  deliverables: z.array(nodeDeliverableSchema).optional(),
  findings: z.array(resultContributionSchema).optional(),
  decisions: z.array(resultContributionSchema).optional(),
  caveats: z.array(resultContributionSchema).optional(),
  nextActions: z.array(resultContributionSchema).optional(),
  evidenceItems: z.array(resultEvidenceSchema).optional(),
}).strict();

export const conditionSelectPayloadSchema = z.object({ nodeId: z.string().min(1), branchRef: z.string().min(1), summary: z.string().min(1), evidence: nodeEvidencePayloadSchema }).strict();

const interactionOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  recommended: z.boolean().optional(),
}).strict();

const textInteractionFieldSchema = z.object({
  kind: z.literal("text"),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  multiline: z.boolean().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.string().optional(),
}).strict();

const choiceInteractionFieldSchema = z.object({
  kind: z.literal("choice"),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  selection: z.enum(["single", "multiple"]),
  options: z.array(interactionOptionSchema).min(1),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  minSelections: z.number().int().nonnegative().optional(),
  maxSelections: z.number().int().positive().optional(),
}).strict();

const booleanInteractionFieldSchema = z.object({
  kind: z.literal("boolean"),
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  defaultValue: z.boolean().optional(),
}).strict();

export const interactionFieldSchema = z.discriminatedUnion("kind", [
  textInteractionFieldSchema,
  choiceInteractionFieldSchema,
  booleanInteractionFieldSchema,
]);

export const requestInputPayloadSchema = z.object({
  title: z.string().min(1),
  instructions: z.string().min(1),
  fields: z.array(interactionFieldSchema).min(1),
  submitLabel: z.string().min(1).optional(),
  relatedOutputElementIds: z.array(z.string().min(1)).optional(),
  evidence: nodeEvidencePayloadSchema,
}).strict();

const blockActionFormFieldSchema = z.object({ name: z.string().min(1), label: z.string().min(1), type: z.enum(["text", "textarea", "select"]).optional(), required: z.boolean().optional(), options: z.array(z.string().min(1)).optional() }).strict();

const blockActionFormSchema = z.object({ instructions: z.string().min(1), submitLabel: z.string().min(1).optional(), inputFields: z.array(blockActionFormFieldSchema).min(1) }).strict();

export const blockPayloadSchema = z.object({ reason: z.string().min(1), actionForm: blockActionFormSchema, retryable: z.boolean().optional(), evidence: nodeEvidencePayloadSchema }).strict();

export const failPayloadSchema = z.object({ error: z.string().min(1), retryable: z.boolean().optional(), diagnostics: z.unknown().optional(), evidence: nodeEvidencePayloadSchema }).strict();

export const waitCompletePayloadSchema = z.object({ summary: z.string().min(1), evidence: nodeEvidencePayloadSchema }).strict();
export const dashboardBriefPayloadSchema = z.object({
  summaryText: z.string().trim().min(1).max(500).optional(),
  spec: z.unknown(),
}).strict();


export const chronaToolPayloadSchemas = {
  "chrona.task.read": readPayloadSchema,
  "chrona.task.create": createTaskBodySchema.omit({ workspaceId: true }),
  "chrona.goal.results.read": goalResultsReadPayloadSchema,
  "chrona.task.update": updateTaskBodySchema.omit({ workspaceId: true }),
  "chrona.plan.read": readPayloadSchema,
  "chrona.plan.generate": planGenerateToolPayloadSchema,
  "chrona.plan.mutate": planMutationBodySchema,
  "chrona.schedule.read": readPayloadSchema,
  "chrona.schedule.propose": scheduleProposalBodySchema.omit({ workspaceId: true }),
  "chrona.schedule.set": scheduleBodySchema,
  "chrona.schedule.clear": readPayloadSchema,
  "chrona.execution.read": readPayloadSchema,
  "chrona.execution.dispatch": executionActionBodySchema,
  "chrona.node.read": readPayloadSchema,
  "chrona.dashboard.brief": dashboardBriefPayloadSchema,
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
  "chrona.node.read": publicReadPayloadSchema,
  "chrona.dashboard.brief": dashboardBriefPayloadSchema,
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

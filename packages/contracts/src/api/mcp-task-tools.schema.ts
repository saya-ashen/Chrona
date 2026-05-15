import { z } from "zod";
import { planBlueprintSchema } from "../ai-plan-blueprint";
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

export const chronaToolNames = [
  "chrona.task.read",
  "chrona.task.create",
  "chrona.task.update",
  "chrona.plan.read",
  "chrona.plan.generate",
  "chrona.plan.mutate",
  "chrona.schedule.read",
  "chrona.schedule.propose",
  "chrona.schedule.set",
  "chrona.schedule.clear",
  "chrona.execution.read",
  "chrona.execution.dispatch",
  "chrona.node.result",
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
const nodeResultPayloadSchema = z.object({
  status: z.enum(["complete", "blocked", "failed"]),
  summary: z.string().optional(),
  output: z.unknown().optional(),
  reason: z.string().min(1, "reason is required").optional(),
  error: z.string().min(1, "error is required").optional(),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === "blocked" && !value.reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "reason is required when status is blocked",
    });
  }
  if (value.status === "failed" && !value.error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["error"],
      message: "error is required when status is failed",
    });
  }
});

export const chronaToolPayloadSchemas = {
  "chrona.task.read": readPayloadSchema,
  "chrona.task.create": createTaskBodySchema.omit({ workspaceId: true }),
  "chrona.task.update": updateTaskBodySchema.omit({ workspaceId: true }),
  "chrona.plan.read": readPayloadSchema,
  "chrona.plan.generate": planBlueprintSchema,
  "chrona.plan.mutate": planMutationBodySchema,
  "chrona.schedule.read": readPayloadSchema,
  "chrona.schedule.propose": scheduleProposalBodySchema.omit({ workspaceId: true }),
  "chrona.schedule.set": scheduleBodySchema,
  "chrona.schedule.clear": readPayloadSchema,
  "chrona.execution.read": readPayloadSchema,
  "chrona.execution.dispatch": executionActionBodySchema,
  "chrona.node.result": nodeResultPayloadSchema,
} as const;

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

export function isChronaToolMutating(toolName: ChronaToolName) {
  return !toolName.endsWith(".read");
}

export function parseChronaToolPayload(toolName: ChronaToolName, payload: unknown) {
  return chronaToolPayloadSchemas[toolName].parse(payload ?? {});
}

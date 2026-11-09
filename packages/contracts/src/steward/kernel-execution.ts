import { z } from "zod";
import { executionIdSchema as id, executionRefSchema, executionBaselineSchema, executionViewSchema, executionChangesSchema } from "./execution";
import { executionEventPayloadSchema, executionSnapshotSchema } from "./execution-events";
import { workBaselineSchema, workPlacementSchema, workWorkspaceRequestSchema } from "./execution-v2";

/** Immutable host project authorization for local admission and workspace verification. */
export const localExecutionProjectGrantSchema = workPlacementSchema.extend({ directoryIdentity: z.string().regex(/^[a-f0-9]{64}$/), baseline: workBaselineSchema, label: z.string().min(1).max(200), executor: z.literal("server"), executorId: z.literal("server"), executorGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), canonicalPath: z.string().min(1).max(4096) }).strict();
export type LocalExecutionProjectGrant = z.infer<typeof localExecutionProjectGrantSchema>;

/** Execution locations are capabilities of an activated application or the trusted local host. */
export const kernelPlacementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), projectRef: id, mappingRevision: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("application"), applicationId: id, targetRef: id, targetRevision: z.number().int().positive(), projectRef: id }).strict(),
]);
export const kernelExecutionBudgetSchema = z.object({ timeoutMs: z.number().int().min(1000).max(1_200_000), maxToolCalls: z.number().int().min(1).max(60), maxModelCalls: z.number().int().min(1).max(60), maxOutputTokens: z.number().int().min(1).max(32_000) }).strict();
const executionStartFields = { kind: z.literal("execution"), workId: id, commandKey: id, goal: z.string().trim().min(1).max(20_000), workspace: workWorkspaceRequestSchema, queueExpiresAt: z.string().datetime({ offset: true }) };
export const localExecutionStartSchema = z.object({ ...executionStartFields, placement: kernelPlacementSchema.options[0], budget: kernelExecutionBudgetSchema.pick({ timeoutMs: true, maxToolCalls: true }) }).strict();
export const applicationExecutionStartSchema = z.object({ ...executionStartFields, placement: kernelPlacementSchema.options[1], budget: kernelExecutionBudgetSchema }).strict();
export const kernelExecutionStartSchema = z.union([localExecutionStartSchema, applicationExecutionStartSchema]);
export const executionReceiverSchema = z.object({ workspaceId: id, moduleId: id, hash: id, activationId: id }).strict();
const targetScope = z.object({ targetRef: id, targetRevision: z.number().int().positive(), projectRef: id, directoryIdentity: z.string().min(1).max(512), baseline: executionBaselineSchema, workspaceModes: z.array(z.enum(["existing", "independent_worktree"])).min(1).max(2) }).strict();
export const executionAuthorityApprovalSchema = z.object({ receiver: executionReceiverSchema, subjectId: id, epoch: z.number().int().positive(), keyId: id, publicKey: z.string().min(1).max(4096), verifierId: z.literal("ed25519"), verifierVersion: z.literal("1"), approvalId: id, scope: z.object({ callerModuleIds: z.array(id).max(100), targets: z.array(targetScope).min(1).max(100) }).strict() }).strict();
/** Every effect binds both sides' exact activation and the stable capacity subject. */
export const executionFenceSchema = executionRefSchema.extend({ workspaceId: id, ownerId: id, deliveryId: id, callerModuleId: id.nullable(), callerHash: id.nullable(), callerActivationId: id.nullable(), receiverModuleId: id, receiverHash: id, receiverActivationId: id, authorityId: id, subjectId: id, epoch: z.number().int().positive(), keyId: id }).strict();
export const executionDeliveryTargetSchema = executionFenceSchema.extend({ launchDigest: z.string().regex(/^[a-f0-9]{64}$/) });
export const executionLaunchSchema = z.object({ fence: executionFenceSchema, placement: kernelPlacementSchema, target: targetScope, workspaceRef: id, workspace: workWorkspaceRequestSchema, goal: executionStartFields.goal, budget: kernelExecutionBudgetSchema, deadlineAt: z.string().datetime({ offset: true }) }).strict();
export const executionProcessIdentitySchema = z.object({ id, scope: id }).strict();
export const executionDeliveryFinalSchema = z.object({ outcome: z.enum(["finished", "failed", "cancelled", "timed_out", "unavailable"]), error: z.string().max(1000).nullable(), throughSourceSeq: z.number().int().nonnegative(), baseline: executionBaselineSchema, finalMessage: executionSnapshotSchema.shape.finalMessage, missing: z.boolean(), changes: executionChangesSchema.optional() }).strict();
/** Source payloads are display facts only. They cannot grant authority or attest process exit. */
export const executionDeliverySourceSchema = z.array(z.object({ sequence: z.number().int().positive(), at: z.string().datetime({ offset: true }), payload: executionEventPayloadSchema }).strict()).min(1).max(100).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144, "Source byte limit exceeded");
export const executionStopStatementSchema = z.object({ target: executionDeliveryTargetSchema, kind: z.enum(["exited", "never_started"]), processIdentity: executionProcessIdentitySchema.nullable(), finalDigest: z.string().regex(/^[a-f0-9]{64}$/), sourceThrough: z.number().int().nonnegative(), observedAt: z.string().datetime({ offset: true }) }).strict();
export const executionSignedStopSchema = z.object({ statement: executionStopStatementSchema, signature: z.string().min(1).max(512) }).strict();
export const kernelPlacementViewSchema = executionRefSchema.extend({ placement: kernelPlacementSchema, queueExpiresAt: z.string().datetime({ offset: true }), online: z.boolean(), workspace: z.object({ workspaceRef: id, mode: z.enum(["existing", "independent_worktree"]), baseline: executionBaselineSchema, state: z.enum(["requested", "ready", "unknown", "retained"]), retained: z.literal(true) }).strict() }).strict();
export const kernelLocationSchema = z.object({ placement: kernelPlacementSchema, label: z.string().min(1).max(200), online: z.boolean(), baseline: executionBaselineSchema, workspaceModes: targetScope.shape.workspaceModes }).strict();
export const kernelCleanupInputSchema = z.discriminatedUnion("op", [z.object({ op: z.literal("preview"), workId: id, commandKey: id }).strict(), z.object({ op: z.literal("confirm"), workId: id, commandKey: id, previewDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()]);
export const executionDeliveryModelSchema = z.object({ prompt: z.string().min(1).max(200_000), system: z.string().max(20_000).optional(), maxOutputTokens: z.number().int().positive().max(32_000) }).strict();
export type KernelPlacement = z.infer<typeof kernelPlacementSchema>;
export type KernelExecutionStart = z.infer<typeof kernelExecutionStartSchema>;
export type ExecutionReceiver = z.infer<typeof executionReceiverSchema>;
export type ExecutionAuthorityApproval = z.infer<typeof executionAuthorityApprovalSchema>;
export type ExecutionDeliveryTarget = z.infer<typeof executionDeliveryTargetSchema>;
export type ExecutionLaunch = z.infer<typeof executionLaunchSchema>;
export type ExecutionDeliveryFinal = z.infer<typeof executionDeliveryFinalSchema>;
/** Display fields shared by final-result normalization, independent of transport and stop evidence. */
export type ExecutionFinal = Pick<ExecutionDeliveryFinal, "finalMessage" | "error">;
export type ExecutionSignedStop = z.infer<typeof executionSignedStopSchema>;
export type ExecutionDeliverySource = z.infer<typeof executionDeliverySourceSchema>;
export type KernelPlacementView = z.infer<typeof kernelPlacementViewSchema>;
export type KernelExecutionAdmission = { execution: z.infer<typeof executionViewSchema>; placement: KernelPlacementView };
export type ExecutionDeliveryModel = z.infer<typeof executionDeliveryModelSchema>;

export const kernelCleanupReceiptSchema = z.object({ workId: id, workspaceRef: id, state: z.enum(["pending", "retained", "blocked", "removed", "unknown"]), reason: z.string().max(500), previewDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), operationKey: id.optional() }).strict();
export type KernelLocation = z.infer<typeof kernelLocationSchema>;
export type KernelCleanupInput = z.infer<typeof kernelCleanupInputSchema>;

/** Shared occupancy limits include locally running and application executions with unknown stop. */
export const KERNEL_EXECUTION_LIMITS = { codingGlobal: 4, codingEnvironment: 2, codingApplication: 2 } as const;

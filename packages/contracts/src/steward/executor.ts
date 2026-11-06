import { z } from "zod";
import { executionChangesSchema, executionErrorSchema, executionIdSchema, executionRefSchema, executionStartSchema } from "./execution";
import { executionEventPayloadSchema, executionJsonBytes, executionSnapshotSchema } from "./execution-events";
import { providerAnswerSchema, providerProgressSchema, providerQuestionSchema, providerResourcesSchema, providerUsageSchema } from "./provider";
import { executionSourceSchema, executionSourceReceiptSchema, workPlacementSchema, workBaselineSchema, workCleanupInputSchema, workCleanupReceiptSchema } from "./execution-v2";

export const EXECUTOR_PROTOCOL = "chrona.executor.v1" as const;
export const EXECUTOR_LIMITS = {
  heartbeatMs: 10_000, graceMs: 60_000, pollMs: 10_000, requestTimeoutMs: 15_000, pairMs: 600_000, pairReceiptMs: 86_400_000,
  records: 100, recordBytes: 32_768, eventBytes: 262_144, bodyBytes: 524_288, finalBytes: 196_608, launchBytes: 65_536, proofBytes: 4096,
  bufferRecords: 128, bufferBytes: 524_288, spoolBytes: 10_485_760, sourceReceipts: 8192, receiptBytes: 1_048_576,
  terminalBytes: 262_144, deviceSpoolBytes: 23_592_960, deviceReceiptBytes: 2_097_152, globalReceiptBytes: 16_777_216,
  assignmentRecords: 1024, deviceRecords: 32, pairingRecords: 128, reconcileEntries: 100, controls: 100, controlReceipts: 128,
  codingGlobal: 4, codingEnvironment: 2, codingApplication: 2,
} as const;
const id = executionIdSchema;
const iso = z.string().datetime({ offset: true }).max(40);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = count.positive();
const bounded = (limit: number) => (value: unknown) => executionJsonBytes(value) <= limit;
export const executorIdentitySchema = z.object({ executorId: id, generation: positive }).strict();
export const executorFenceSchema = executorIdentitySchema.extend({ incarnation: id }).strict();
export const executorTargetSchema = executionRefSchema.extend({ assignmentId: id, generation: positive }).strict();
const envelope = { v: z.literal(EXECUTOR_PROTOCOL), requestId: id };
const request = { ...envelope, ...executorFenceSchema.shape };
/** Credential is generated and durably saved locally BEFORE exchange; it travels only in Authorization. */
export const executorPairSchema = z.object({ ...envelope, code: z.string().regex(/^[a-f0-9]{64}$/), label: z.string().trim().min(1).max(200) }).strict();
export const executorPairReceiptSchema = executorIdentitySchema.extend({ heartbeatMs: z.literal(EXECUTOR_LIMITS.heartbeatMs), graceMs: z.literal(EXECUTOR_LIMITS.graceMs) }).strict();
/** Immutable process-snapshot grant. Device variants contain no host path. */
export const executorMappingSchema = workPlacementSchema.extend({ directoryIdentity: digest, baseline: workBaselineSchema, label: z.string().min(1).max(200) }).strict();
export const executionProjectGrantP2Schema = z.discriminatedUnion("executor", [
  executorMappingSchema.extend({ executor: z.literal("server"), executorId: z.literal("server"), executorGeneration: positive, canonicalPath: z.string().min(1).max(4096) }).strict(),
  executorMappingSchema.extend({ executor: z.literal("device"), executorGeneration: positive }).strict(),
]);
export const executorAssignmentSchema = executorTargetSchema.extend({
  executorId: id, incarnation: id, mapping: executorMappingSchema, workspaceRef: id,
  workspaceMode: z.enum(["existing", "independent_worktree"]), source: executionSourceSchema.optional(),
  goal: executionStartSchema.shape.goal, budget: executionStartSchema.shape.budget, deadlineAt: iso,
}).strict().refine(value => value.workspaceMode !== "independent_worktree" || value.mapping.baseline.kind === "commit", "Independent worktree requires a commit")
  .refine(bounded(EXECUTOR_LIMITS.launchBytes), "Launch exceeds byte budget");
/** Runtime fields do not enter launchDigest; assignment is the complete stable digest input. */
export const executorLaunchSchema = z.object({ assignment: executorAssignmentSchema, launchDigest: digest, remainingMs: positive.max(1_200_000), offlineGraceMs: z.literal(EXECUTOR_LIMITS.graceMs) }).strict();
export const executorProcessIdentitySchema = z.object({
  bootId: z.string().uuid(), unit: z.string().regex(/^chrona-executor-[a-f0-9-]+\.service$/),
  invocationId: z.string().regex(/^[a-f0-9]{32}$/),
  controlGroup: z.string().min(1).max(1024).regex(/^\//).refine(value => !value.split("/").some(part => part === "." || part === "..") && !/[\0\r\n]/.test(value)),
}).strict();
export const executorStopProofSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cgroup_empty"), identity: executorProcessIdentitySchema, observedAt: iso,
    observer: z.enum(["open_cgroup_events", "systemd_tracked"]), populated: z.literal(0), observationDigest: digest }).strict(),
  z.object({ kind: z.literal("never_started"), tombstoneDigest: digest }).strict(),
  z.object({ kind: z.literal("unknown"), reason: z.string().min(1).max(500) }).strict(),
]).refine(bounded(EXECUTOR_LIMITS.proofBytes), "Stop proof exceeds byte budget");
/** Device details cannot create authoritative questions or claim that a process has stopped. */
export const executorDetailSchema = z.discriminatedUnion("type", [
  executionEventPayloadSchema.options[0], executionEventPayloadSchema.options[1], executionEventPayloadSchema.options[2],
  executionEventPayloadSchema.options[3], executionEventPayloadSchema.options[7],
]);
export const executorSourceRecordSchema = z.object({ sourceSeq: positive, digest, at: iso, item: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("detail"), payload: executorDetailSchema }).strict(),
  z.object({ kind: z.literal("progress"), value: providerProgressSchema }).strict(),
  z.object({ kind: z.literal("usage"), value: providerUsageSchema }).strict(),
  z.object({ kind: z.literal("resources"), value: providerResourcesSchema }).strict(),
  z.object({ kind: z.literal("gap"), throughSourceSeq: positive, reason: z.enum(["truncated", "backpressure"]) }).strict(),
]) }).strict().refine(value => value.item.kind !== "gap" || value.item.throughSourceSeq >= value.sourceSeq, "Gap must cover its source position")
  .refine(bounded(EXECUTOR_LIMITS.recordBytes), "Source record exceeds byte budget");
export const executorControlSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("cancel"), target: executorTargetSchema }).strict(),
  z.object({ op: z.literal("inject"), target: executorTargetSchema, commandKey: id, text: z.string().min(1).max(20_000) }).strict(),
]);
export const executorQuestionReplySchema = z.discriminatedUnion("state", [
  z.object({ target: executorTargetSchema, questionKey: id, requestId: id, state: z.literal("answer"), answer: providerAnswerSchema }).strict(),
  z.object({ target: executorTargetSchema, questionKey: id, requestId: id, state: z.enum(["pending", "interrupted"]) }).strict(),
]);
/** Owner cleanup rides the existing authenticated poll/report transport; no filesystem paths enter the wire. */
export const executorCleanupOperationSchema = z.object({ target: executorTargetSchema, launchDigest: digest, workspaceRef: id,
  mappingRevision: executorMappingSchema.shape.mappingRevision, sourceReceiptDigest: digest.nullable(), input: workCleanupInputSchema, requestDigest: digest,
}).strict().refine(value => value.target.workId === value.input.workId, "Cleanup work identity mismatch");
export const executorCleanupResultSchema = z.object({ commandKey: id, requestDigest: digest, receipt: workCleanupReceiptSchema }).strict();
export const executorPollSchema = z.object({ ...request, waitMs: count.max(EXECUTOR_LIMITS.pollMs) }).strict();
export const executorPollReceiptSchema = executorFenceSchema.extend({ authorizedForMs: count.max(EXECUTOR_LIMITS.graceMs), launches: z.array(executorLaunchSchema).max(EXECUTOR_LIMITS.codingEnvironment),
  controls: z.array(executorControlSchema).max(EXECUTOR_LIMITS.controls), questions: z.array(executorQuestionReplySchema).max(6),
  cleanupOperations: z.array(executorCleanupOperationSchema).max(4).optional() }).strict()
  .refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Poll receipt exceeds byte budget");
export const executorReportSchema = z.object({ ...request, target: executorTargetSchema,
  records: z.array(executorSourceRecordSchema).max(EXECUTOR_LIMITS.records).refine(bounded(EXECUTOR_LIMITS.eventBytes), "Record batch exceeds byte budget"),
  started: z.object({ launchDigest: digest, identity: executorProcessIdentitySchema, sourceReceipt: executionSourceReceiptSchema.nullable() }).strict().optional(),
  consumed: z.array(z.object({ commandKey: id, effect: z.enum(["delivered", "unknown"]) }).strict()).max(EXECUTOR_LIMITS.controls).optional(),
  cleanupResults: z.array(executorCleanupResultSchema).max(4).optional(),
}).strict().refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Report exceeds byte budget");
export const executorReportReceiptSchema = z.object({ acceptedThroughSourceSeq: count, storedHighWatermark: count }).strict();
export const executorQuestionSchema = z.object({ ...request, target: executorTargetSchema, questionKey: id, value: providerQuestionSchema }).strict();
/** data.requestId is ProviderInteraction.id; the outer envelope alone echoes the HTTP requestId. */
export const executorQuestionReceiptSchema = z.object({ target: executorTargetSchema, questionKey: id, requestId: id, state: z.enum(["pending", "interrupted"]) }).strict();
export const executorFinalSchema = executorTargetSchema.extend({
  throughSourceSeq: count, baseline: workBaselineSchema, launchDigest: digest,
  outcome: z.object({ outcome: z.enum(["finished", "failed", "timed_out", "unavailable"]), sessionId: id.nullable(), error: z.string().max(1000).nullable() }).strict(),
  finalMessage: executionSnapshotSchema.shape.finalMessage, missing: z.boolean(), sourceReceipt: executionSourceReceiptSchema.nullable(),
  changes: executionChangesSchema.optional(), stop: executorStopProofSchema,
}).strict().refine(bounded(EXECUTOR_LIMITS.finalBytes - 1024), "Final exceeds reserved envelope budget");
export const executorFinalRequestSchema = z.object({ ...request, digest, final: executorFinalSchema }).strict()
  .refine(bounded(EXECUTOR_LIMITS.finalBytes), "Final request exceeds byte budget");
export const executorFinalReceiptSchema = z.object({ digest, accepted: z.literal(true), stopConfirmed: z.boolean() }).strict();
export const executorReconcileEntrySchema = z.object({ target: executorTargetSchema, launchDigest: digest,
  phase: z.enum(["intent", "owned", "started", "stopping", "unknown", "final"]), identity: executorProcessIdentitySchema.optional(),
  sourceAck: count, finalDigest: digest.optional(), stop: executorStopProofSchema.optional(),
}).strict();
export const executorReconcileSchema = z.object({ ...request, entries: z.array(executorReconcileEntrySchema).max(EXECUTOR_LIMITS.reconcileEntries), after: id.nullable(), complete: z.boolean() }).strict()
  .refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Reconciliation exceeds byte budget");
export const executorReconcileReceiptSchema = executorFenceSchema.extend({ decisions: z.array(z.object({ target: executorTargetSchema, action: z.enum(["stop", "report", "ack_final", "unknown"]) }).strict()).max(EXECUTOR_LIMITS.reconcileEntries), after: id.nullable(), reconciled: z.boolean() }).strict();
/** Local extension facade only. Remote module catalog is empty; direct calls are forbidden. */
export const EXECUTOR_MODULE_CATALOG = [] as const;
export const executorBridgeSchema = z.object({ ...request, target: executorTargetSchema, call: z.discriminatedUnion("op", [
  z.object({ op: z.literal("progress"), value: providerProgressSchema }).strict(),
  z.object({ op: z.literal("usage"), value: providerUsageSchema }).strict(),
  z.object({ op: z.literal("resources"), value: providerResourcesSchema }).strict(),
  z.object({ op: z.literal("question"), questionKey: id, value: providerQuestionSchema }).strict(),
]) }).strict().refine(bounded(EXECUTOR_LIMITS.recordBytes), "Bridge request exceeds byte budget");
/** Durable device journal: atomic intent precedes spawn; tombstones and finals survive ACK loss. No credential or answer fields. */
export const executorJournalSchema = z.object({ assignment: executorAssignmentSchema, launchDigest: digest,
  phase: z.enum(["intent", "owned", "started", "stopping", "unknown", "final"]),
  identity: executorProcessIdentitySchema.nullable(), sourceAck: count, sourceProduced: count,
  consumedControls: z.array(z.object({ commandKey: id, effect: z.enum(["delivered", "unknown"]) }).strict()).max(EXECUTOR_LIMITS.controlReceipts),
  final: executorFinalSchema.nullable(), finalDigest: digest.nullable(), tombstoneDigest: digest.nullable(),
}).strict().refine(value => value.sourceAck <= value.sourceProduced && (value.final === null) === (value.finalDigest === null), "Journal positions or final digest disagree")
  .refine(value => (value.phase !== "final" || value.final !== null) && (!["owned", "started", "stopping"].includes(value.phase) || value.identity !== null), "Journal phase lacks its durable identity/final");
export const executorRequestSchemas = { pair: executorPairSchema, poll: executorPollSchema, report: executorReportSchema, question: executorQuestionSchema, final: executorFinalRequestSchema, reconcile: executorReconcileSchema } as const;
export const executorResponseDataSchemas = { pair: executorPairReceiptSchema, poll: executorPollReceiptSchema, report: executorReportReceiptSchema, question: executorQuestionReceiptSchema, final: executorFinalReceiptSchema, reconcile: executorReconcileReceiptSchema } as const;
/** Exact method/path exemption only; owner pairing-code/revoke routes keep owner API_KEY authentication. */
export const EXECUTOR_HTTP = {
  pair: { method: "POST", path: "/api/executor/v1/pair", auth: "pair_credential", bytes: 4096 },
  poll: { method: "POST", path: "/api/executor/v1/poll", auth: "active", bytes: 4096 },
  report: { method: "POST", path: "/api/executor/v1/report", auth: "active", bytes: EXECUTOR_LIMITS.bodyBytes },
  question: { method: "POST", path: "/api/executor/v1/question", auth: "active", bytes: EXECUTOR_LIMITS.recordBytes },
  final: { method: "POST", path: "/api/executor/v1/final", auth: "active_or_drain", bytes: EXECUTOR_LIMITS.finalBytes },
  reconcile: { method: "POST", path: "/api/executor/v1/reconcile", auth: "active_or_drain", bytes: EXECUTOR_LIMITS.bodyBytes },
} as const;
/** Same recursive key ordering as executionDigest; arrays retain order. Hash only parsed stable objects. */
export function executorCanonicalJson(input: unknown): string {
  return JSON.stringify(input, (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
export async function executorDigest(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(executorCanonicalJson(input));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export const executorOwnerPairSchema = z.object({ label: z.string().trim().min(1).max(200) }).strict();
export const executorOwnerRevokeSchema = executorIdentitySchema.extend({ commandKey: id }).strict();
export const executorOwnerIncarnationSchema = executorIdentitySchema.extend({ expectedIncarnation: id, nextIncarnation: id, commandKey: id }).strict()
  .refine(value => value.expectedIncarnation !== value.nextIncarnation, "Incarnation must change");
export type ExecutorOwnerIncarnation = z.infer<typeof executorOwnerIncarnationSchema>;
/** These routes are NEVER exempt from owner auth. Pairing code response is secret and must be redacted. */
export const EXECUTOR_OWNER_HTTP = { pairingCodes: { method: "POST", path: "/api/executor/v1/pairing-codes" }, revoke: { method: "POST", path: "/api/executor/v1/revoke" }, incarnation: { method: "POST", path: "/api/executor/v1/incarnation" } } as const;
export const executorErrorEnvelopeSchema = z.object({ ...envelope, ok: z.literal(false), error: executionErrorSchema }).strict();
/** Endpoint-specific response validation; correlation is checked before acting on a launch or renewing a lease. */
export function parseExecutorResponse<K extends keyof typeof executorResponseDataSchemas>(op: K, requestId: string, raw: unknown) {
  return z.discriminatedUnion("ok", [
    z.object({ ...envelope, requestId: z.literal(requestId), ok: z.literal(true), data: executorResponseDataSchemas[op] }).strict(),
    z.object({ ...envelope, requestId: z.literal(requestId), ok: z.literal(false), error: executionErrorSchema }).strict(),
  ]).refine(bounded(EXECUTOR_LIMITS.bodyBytes), "Executor response exceeds byte budget").parse(raw);
}
export type ExecutorOperation = keyof typeof executorRequestSchemas;
export type ExecutorRequests = { [K in ExecutorOperation]: z.infer<(typeof executorRequestSchemas)[K]> };
export type ExecutorResponses = { [K in ExecutorOperation]: z.infer<(typeof executorResponseDataSchemas)[K]> };
export type ExecutorIdentity = z.infer<typeof executorIdentitySchema>;
export type ExecutorFence = z.infer<typeof executorFenceSchema>;
export type ExecutorTarget = z.infer<typeof executorTargetSchema>;
export type ExecutorAssignment = z.infer<typeof executorAssignmentSchema>;
export type ExecutorReport = z.infer<typeof executorReportSchema>;
export type ExecutorCleanupOperation = z.infer<typeof executorCleanupOperationSchema>;
export type ExecutorCleanupResult = z.infer<typeof executorCleanupResultSchema>;
export type ExecutorSourceRecord = z.infer<typeof executorSourceRecordSchema>;
export type ExecutorFinal = z.infer<typeof executorFinalSchema>;
export type ExecutorStopProof = z.infer<typeof executorStopProofSchema>;
export type ExecutorPoll = z.infer<typeof executorPollSchema>;
export type ExecutorPollReceipt = z.infer<typeof executorPollReceiptSchema>;
export type ExecutorBridge = z.infer<typeof executorBridgeSchema>;
export type ExecutorMapping = z.infer<typeof executorMappingSchema>;
export type ExecutionProjectGrantP2 = z.infer<typeof executionProjectGrantP2Schema>;
export type ExecutorPrincipal = ExecutorFence & { workspaceId: string; ownerId: string; mode: "active" | "drain" | "recovery" };
export type ExecutorController = { [K in Exclude<ExecutorOperation, "pair">]: (principal: ExecutorPrincipal, input: ExecutorRequests[K], signal: AbortSignal) => Promise<ExecutorResponses[K]> } & {
  pair(credential: string, input: ExecutorRequests["pair"]): Promise<ExecutorResponses["pair"]>;
  authenticate(credential: string, fence: ExecutorFence, mode: "active" | "drain"): Promise<ExecutorPrincipal>;
};

import { z } from "zod";
import { providerAnswerSchema } from "./provider";

/** Candidate P1 protocol; exports alone do not register a runtime service. */
export const EXECUTION_PROTOCOL = "chrona.execution.v1" as const;
export const executionIdSchema = z.string().min(1).max(128).regex(/^[\w:.-]+$/);
const id = executionIdSchema;
export const executionRefSchema = z.object({ workId: id, sessionId: id, runId: id, attemptId: id }).strict();
export const executionStartSchema = z.object({
  workId: id, projectRef: id, commandKey: id, goal: z.string().trim().min(1).max(20_000),
  budget: z.object({ timeoutMs: z.number().int().min(1000).max(1_200_000), maxToolCalls: z.number().int().min(1).max(60) }).strict(),
}).strict();
export const executionStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "unknown"]);
export const executionViewSchema = executionRefSchema.extend({
  projectRef: id, status: executionStatusSchema,
  cancelRequested: z.boolean(), stopConfirmed: z.boolean(),
}).strict().refine(value => value.status !== "cancelled" || value.stopConfirmed, "Cancellation needs stop evidence");
export const executionErrorSchema = z.object({
  code: z.enum(["invalid", "unauthorized", "forbidden", "not_found", "conflict", "cursor_expired", "too_large", "capacity", "unavailable", "unsupported_version", "unsupported"]),
  message: z.string().min(1).max(500), retryable: z.boolean(), retryAfterMs: z.number().int().min(0).max(60_000).optional(),
}).strict();
export const executionCapabilitiesSchema = z.object({
  history: z.literal(true), messages: z.literal(true), tools: z.literal(true), answer: z.literal(true), cancel: z.literal(true), results: z.literal(true),
  raw_rpc: z.literal(false), thinking: z.literal(false), direct_bash: z.literal(false), tree: z.literal(false), compaction: z.literal(false), commands: z.literal(false), models: z.literal(false),
  attachments: z.literal(false), changed_files: z.literal(false), follow_up: z.literal(false),
}).strict();
export const EXECUTION_CAPABILITIES = executionCapabilitiesSchema.parse({ history: true, messages: true, tools: true, answer: true, cancel: true, results: true, raw_rpc: false, thinking: false, direct_bash: false, tree: false, compaction: false, commands: false, models: false, attachments: false, changed_files: false, follow_up: false });
const target = { workId: id, runId: id, attemptId: id };
const command = { ...target, commandKey: id };
export const executionCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("start"), ...executionStartSchema.shape }).strict(),
  z.object({ op: z.literal("get"), workId: id }).strict(),
  z.object({ op: z.literal("lookup_start"), commandKey: id }).strict(),
  z.object({ op: z.literal("list"), after: id.optional(), limit: z.number().int().min(1).max(100) }).strict(),
  z.object({ op: z.literal("send"), ...command, text: z.string().trim().min(1).max(20_000) }).strict(),
  z.object({ op: z.literal("answer"), ...command, requestId: id, answer: providerAnswerSchema }).strict(),
  z.object({ op: z.literal("cancel"), ...command }).strict(),
  z.object({ op: z.literal("attach"), workId: id, cursor: z.string().max(1024).optional() }).strict(),
  z.object({ op: z.literal("detach"), workId: id }).strict(),
  z.object({ op: z.literal("events"), ...target, cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100), waitMs: z.number().int().min(0).max(15_000) }).strict(),
  z.object({ op: z.literal("snapshot"), ...target }).strict(),
  z.object({ op: z.literal("results"), workId: id }).strict(),
  z.object({ op: z.literal("accept"), workId: id, resultId: id, commandKey: id }).strict(),
]);
const [start, get, lookupStart, list, send, answer, cancel, attach, detach, events, snapshot, results, accept] = executionCommandSchema.options;
/** Routed tools consume the same payload fields, without the editor's op discriminant. */
export const executionInputSchemas = {
  start: start.omit({ op: true }), get: get.omit({ op: true }), lookup_start: lookupStart.omit({ op: true }), list: list.omit({ op: true }),
  send: send.omit({ op: true }), answer: answer.omit({ op: true }), cancel: cancel.omit({ op: true }), attach: attach.omit({ op: true }),
  detach: detach.omit({ op: true }), events: events.omit({ op: true }), snapshot: snapshot.omit({ op: true }), results: results.omit({ op: true }), accept: accept.omit({ op: true }),
} as const;
export const editorRequestSchema = z.object({ v: z.literal(EXECUTION_PROTOCOL), requestId: id, command: executionCommandSchema }).strict();
/** Internal result provenance is read from the admitted attempt, not inferred from model text. */
export const executionBaselineSchema = z.object({ kind: z.enum(["commit", "snapshot"]), digest: z.string().min(1).max(128) }).strict();
export const executionResultSourceInputSchema = z.object(target).strict();
export const EXECUTION_CHANGES_LIMITS = { bytes: 131_072, files: 100, fileBytes: 65_536, timeoutMs: 5000 } as const;
/** Final authorized workspace relative to the explicit baseline; never a claim of exclusive authorship. */
export const executionChangesSchema = z.object({
  scope: z.literal("baseline_to_worktree"), status: z.enum(["complete", "partial", "unavailable"]),
  reason: z.enum(["snapshot_unresolvable", "baseline_unverified", "not_git", "capture_failed", "limit"]).optional(),
  patch: z.string().max(EXECUTION_CHANGES_LIMITS.bytes),
  files: z.array(z.object({ path: z.string().min(1).max(4096), kind: z.enum(["tracked", "untracked"]), text: z.string().max(EXECUTION_CHANGES_LIMITS.fileBytes).optional(), omitted: z.enum(["binary", "symlink", "size", "encoding", "unsupported"]).optional() }).strict()).max(EXECUTION_CHANGES_LIMITS.files),
}).strict().refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= EXECUTION_CHANGES_LIMITS.bytes, "Changes exceed byte budget");
export const executionResultSourceSchema = executionRefSchema.extend({ baseline: executionBaselineSchema, changes: executionChangesSchema.optional() }).strict();
/** Host configuration stores the kind explicitly in the existing baseline string. */
export const executionHostBaselineSchema = z.string().regex(/^(commit|snapshot):[^\r\n]+$/).refine(value => value.slice(value.indexOf(":") + 1).length <= 128, "Baseline digest exceeds limit");
export const executionResultSchema = executionRefSchema.extend({
  resultId: id, baseline: executionBaselineSchema,
  artifactRef: id, accepted: z.boolean(),
  checks: z.array(z.object({ command: z.string().min(1).max(1000), outcome: z.enum(["passed", "failed", "not_run"]), exitCode: z.number().int().nullable() }).strict()).max(50),
}).strict();
export type ExecutionError = z.infer<typeof executionErrorSchema>;
export type ExecutionStart = z.infer<typeof executionStartSchema>;
export type ExecutionRef = z.infer<typeof executionRefSchema>;
export type ExecutionView = z.infer<typeof executionViewSchema>;
export type ExecutionCommand = z.infer<typeof executionCommandSchema>;
export type ExecutionResult = z.infer<typeof executionResultSchema>;
export type ExecutionResultSource = z.infer<typeof executionResultSourceSchema>;
/** Trusted routed context only; never decoded from an editor body or accepted as tool input. */
export type ExecutionPrincipal = { workspaceId: string; ownerId: string; caller: { kind: "owner" } | { kind: "module"; moduleId: string; hash: string } };
export type ExecutionProjectGrant = { projectRef: string; executor: "server"; canonicalPath: string; baseline: string };
/** Future implementation must atomically deduplicate start and enqueue in the existing Run transaction. */
export interface ExecutionPorts {
  start(principal: ExecutionPrincipal, input: ExecutionStart): Promise<ExecutionView>;
  get(principal: ExecutionPrincipal, workId: string): Promise<ExecutionView>;
  lookupStart(principal: ExecutionPrincipal, commandKey: string): Promise<ExecutionView>;
  resultSource(principal: ExecutionPrincipal, input: z.infer<typeof executionResultSourceInputSchema>): Promise<ExecutionResultSource>;
  list(principal: ExecutionPrincipal, input: { after?: string; limit: number }): Promise<{ works: ExecutionView[]; after: string | null }>;
  send(principal: ExecutionPrincipal, input: Extract<ExecutionCommand, { op: "send" }>): Promise<void>;
  answer(principal: ExecutionPrincipal, input: Extract<ExecutionCommand, { op: "answer" }>): Promise<void>;
  cancel(principal: ExecutionPrincipal, input: Extract<ExecutionCommand, { op: "cancel" }>): Promise<ExecutionView>;
}

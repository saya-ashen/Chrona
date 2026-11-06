import { z } from "zod";
import { EXECUTION_PROTOCOL, executionInputSchemas, executionErrorSchema, executionViewSchema, executionResultSchema, executionCapabilitiesSchema, executionIdSchema as id, executionRefSchema, executionStatusSchema, type ExecutionPrincipal, type ExecutionRef } from "./execution";

export const EXECUTION_EVENT_LIMITS = {
  eventBytes: 32 * 1024, pageEvents: 100, pageBytes: 256 * 1024,
  bufferEvents: 128, bufferBytes: 256 * 1024, flushMs: 250,
  attemptBytes: 10 * 1024 * 1024, detailRetentionMs: 7 * 86400_000,
  snapshotRetentionMs: 30 * 86400_000, detailGlobalBytes: 256 * 1024 * 1024,
  snapshotBytes: 256 * 1024, snapshotGlobalBytes: 16 * 1024 * 1024,
  controlBytes: 1024, controlGlobalBytes: 4 * 1024 * 1024, controlSlotsPerAttempt: 4,
  pollMs: 15_000, clientTimeoutMs: 20_000, ownerPolls: 4,
} as const;
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const at = z.string().datetime({ offset: true });
export const executionQuestionSchema = z.object({
  requestId: id, title: z.string().min(1).max(200),
  method: z.enum(["select", "confirm", "input", "editor"]), options: z.array(z.string().max(300)).max(30),
  expiresAt: at, status: z.enum(["pending", "answered", "cancelled", "expired", "interrupted"]),
}).strict();
const boundedText = z.string().max(24_000);
export const executionControlSchema = z.object({
  slot: z.enum(["admission", "cancel", "revoke", "terminal"]), at,
  status: z.enum(["requested", "confirmed", "unknown"]), requestId: id.optional(),
}).strict().refine(value => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.controlBytes, "Control slot byte limit exceeded");
export const executionEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), messageId: id, role: z.enum(["user", "assistant"]), text: boundedText, complete: z.boolean() }).strict(),
  z.object({ type: z.literal("text_delta"), messageId: id, delta: boundedText }).strict(),
  z.object({ type: z.literal("tool_started"), toolCallId: id, tool: z.string().min(1).max(100), display: z.object({ path: z.string().max(1000).optional(), command: z.string().max(1000).optional() }).strict() }).strict(),
  z.object({ type: z.literal("tool_finished"), toolCallId: id, tool: z.string().min(1).max(100), isError: z.boolean(), summary: boundedText, truncated: z.boolean(), originalBytes: seq, artifactRef: id.optional() }).strict(),
  z.object({ type: z.literal("question"), question: executionQuestionSchema }).strict(),
  z.object({ type: z.literal("state"), status: executionStatusSchema, cancelRequested: z.boolean(), stopConfirmed: z.boolean() }).strict(),
  z.object({ type: z.literal("gap"), from: seq, through: seq, reason: z.enum(["expired", "truncated", "backpressure", "out_of_order"]) }).strict(),
  z.object({ type: z.literal("usage"), input: seq, output: seq }).strict(),
]);
export function executionJsonBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export const executionEventSchema = executionRefSchema.extend({ seq, at, payload: executionEventPayloadSchema }).strict()
  .refine(value => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.eventBytes, "Event byte limit exceeded");
export const executionEventBatchSchema = z.array(executionEventSchema).max(EXECUTION_EVENT_LIMITS.pageEvents)
  .refine(value => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.pageBytes, "Batch byte limit exceeded");
export const executionSnapshotSchema = executionRefSchema.extend({
  highWatermark: seq, status: executionStatusSchema, cancelRequested: z.boolean(), stopConfirmed: z.boolean(),
  finalMessage: z.object({ messageId: id, text: boundedText, artifactRef: id.optional(), truncated: z.boolean() }).strict().nullable(),
  questions: z.array(executionQuestionSchema).max(12), missing: z.boolean(), expiresAt: at,
}).strict().refine(value => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.snapshotBytes, "Snapshot byte limit exceeded");
export const executionEventPageSchema = z.object({
  events: executionEventBatchSchema, cursor: z.string().max(1024), highWatermark: seq,
  gap: z.boolean(), snapshotRequired: z.boolean(),
}).strict().refine(value => executionJsonBytes(value) <= EXECUTION_EVENT_LIMITS.pageBytes, "Page byte limit exceeded");
export const executionClientMessageSchema = z.object({
  type: z.enum(["message_started", "message_finished"]),
  message: z.object({ id, role: z.enum(["user", "assistant"]), content: z.array(z.object({ type: z.literal("text"), text: boundedText }).strict()).max(1) }).strict(),
}).strict();
export const executionAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export const executionListSchema = z.object({ works: z.array(executionViewSchema).max(100), after: id.nullable() }).strict();
export const executionResultsSchema = z.object({ results: z.array(executionResultSchema).max(100) }).strict();
/** Each op has exactly one success data shape; the wire envelope is unchanged. */
export const editorResponseDataSchemas = {
  start: executionViewSchema, get: executionViewSchema, lookup_start: executionViewSchema, cancel: executionViewSchema, attach: executionViewSchema,
  list: executionListSchema, send: executionAcceptedSchema, answer: executionAcceptedSchema, detach: executionAcceptedSchema, accept: executionAcceptedSchema,
  events: executionEventPageSchema, snapshot: executionSnapshotSchema, results: executionResultsSchema,
} as const;
export const EDITOR_HTTP = { commands: "/api/editor/v1/commands", events: "/api/editor/v1/events" } as const;
// Reuse the events command bounds; decimal query strings are the only HTTP conversion.
const eventsFields = executionInputSchemas.events.shape;
export const editorEventsQuerySchema = z.object({
  v: z.literal(EXECUTION_PROTOCOL), requestId: id, workId: eventsFields.workId, runId: eventsFields.runId, attemptId: eventsFields.attemptId,
  cursor: eventsFields.cursor, limit: z.string().regex(/^\d+$/).transform(Number).pipe(eventsFields.limit),
  waitMs: z.string().regex(/^\d+$/).transform(Number).pipe(eventsFields.waitMs),
}).strict();
export const EXECUTION_HTTP_STATUS = {
  invalid: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, cursor_expired: 410,
  too_large: 413, capacity: 429, unavailable: 503, unsupported_version: 409, unsupported: 400,
} as const satisfies Record<z.infer<typeof executionErrorSchema>["code"], number>;
export const editorResponseSchema = z.discriminatedUnion("ok", [
  z.object({ v: z.literal(EXECUTION_PROTOCOL), requestId: id, ok: z.literal(true), data: z.union([
    executionViewSchema, executionEventPageSchema, executionSnapshotSchema, executionCapabilitiesSchema,
    executionAcceptedSchema, executionListSchema, executionResultsSchema,
  ]) }).strict(),
  z.object({ v: z.literal(EXECUTION_PROTOCOL), requestId: id, ok: z.literal(false), error: executionErrorSchema }).strict(),
]);
export type ExecutionControl = z.infer<typeof executionControlSchema>;
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
export type ExecutionPayload = z.infer<typeof executionEventPayloadSchema>;
export type ExecutionSnapshot = z.infer<typeof executionSnapshotSchema>;
export type ExecutionEventPage = z.infer<typeof executionEventPageSchema>;
export type ExecutionEventRead = ExecutionRef & { cursor?: string; limit: number; waitMs: number; signal?: AbortSignal };
/** All authorization/budget checks happen before allocation or payload reads. */
export interface ExecutionEventStore {
  append(principal: ExecutionPrincipal, event: ExecutionEvent): Promise<void>;
  read(principal: ExecutionPrincipal, input: ExecutionEventRead): Promise<ExecutionEventPage>;
  snapshot(principal: ExecutionPrincipal, ref: ExecutionRef): Promise<ExecutionSnapshot>;
}
export type ExecutionEventSink = Pick<ExecutionEventStore, "append">;
/** F binds the trusted principal before giving a sink to the Provider. */
export type ExecutionDetailSink = { append(event: ExecutionEvent): Promise<void> };

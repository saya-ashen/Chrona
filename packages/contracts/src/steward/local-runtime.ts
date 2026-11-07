import { z } from "zod";
import { providerQuestionSchema, providerProgressSchema, providerUsageSchema, providerResourcesSchema } from "./provider";
import { executionEventSchema } from "./execution-events";
import { executionRefSchema } from "./execution";

/** Local capability modules use the routed JSON contract; handles and callbacks stay inside their owner. */
export const runtimeOperationSchema = z.object({ operationId: z.string().min(1).max(128) }).strict();
export const runtimeOutcomeSchema = z.object({ outcome: z.enum(["finished", "failed", "timed_out", "unavailable"]), sessionId: z.string().nullable(), error: z.string().nullable() }).strict();
export const runtimeHealthSchema = z.object({ name: z.string().min(1), supportsRunModel: z.boolean(), complete: z.boolean(), available: z.boolean(), sandboxed: z.boolean(), error: z.string().nullable() }).strict();
export const runtimeCompletionSchema = z.object({ text: z.string(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable() }).strict();
export const runtimeTranscriptSchema = z.array(z.discriminatedUnion("kind", [
  z.object({ at: z.string(), kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ at: z.string(), kind: z.literal("tool"), tool: z.string(), args: z.string() }).strict(),
  z.object({ at: z.string(), kind: z.literal("result"), tool: z.string(), text: z.string(), error: z.boolean() }).strict(),
])).max(300);
export const runtimeImageSchema = z.object({ mime: z.string().max(200), base64: z.string().max(8 * 1024 * 1024) }).strict();
export const runtimeStartSchema = z.object({
  operationId: runtimeOperationSchema.shape.operationId,
  runId: z.string().min(1).max(128), token: z.string().min(1).max(1024), lane: z.enum(["foreground", "background", "build"]),
  cwd: z.string().min(1).max(8192), sessionDir: z.string().min(1).max(8192), sessionId: z.string().nullable(),
  prompt: z.string().max(2 * 1024 * 1024), systemPrompt: z.string().max(200_000), resources: z.enum(["configured", "minimal"]),
  deadline: z.string().datetime({ offset: true }), model: z.string().max(500).optional(),
  images: z.array(runtimeImageSchema).max(10).optional(), extraTools: z.array(z.string().max(200)).max(2000).optional(), searchTools: z.boolean().optional(),
  hostPaths: z.array(z.string().max(8192)).max(1000).optional(),
  content: z.array(z.object({ name: z.string().max(200), dir: z.string().max(8192), writable: z.boolean() }).strict()).max(100).optional(),
  execution: executionRefSchema.optional(), executionBudget: z.object({ maxToolCalls: z.number().int().positive() }).strict().optional(),
  callbacks: z.string().uuid().optional(),
}).strict();
export const runtimeEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("progress"), value: providerProgressSchema }).strict(),
  z.object({ kind: z.literal("usage"), value: providerUsageSchema }).strict(),
  z.object({ kind: z.literal("resources"), value: providerResourcesSchema }).strict(),
  z.object({ kind: z.literal("detail"), value: executionEventSchema }).strict(),
  z.object({ kind: z.literal("question"), requestId: z.string().uuid(), value: providerQuestionSchema }).strict(),
  z.object({ kind: z.literal("interrupt"), requestId: z.string().uuid() }).strict(),
]);
export type RuntimeStart = z.infer<typeof runtimeStartSchema>;
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

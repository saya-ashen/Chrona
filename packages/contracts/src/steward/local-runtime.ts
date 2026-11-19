import { z } from "zod";
import { providerQuestionSchema, providerProgressSchema, providerUsageSchema, providerResourcesSchema } from "./provider";

/** Local capability modules use the routed JSON contract; handles and callbacks stay inside their owner. */
export const runtimeOperationSchema = z.object({ operationId: z.string().min(1).max(128) }).strict();
export const runtimeOutcomeSchema = z.object({ outcome: z.enum(["finished", "failed", "timed_out", "unavailable"]), sessionId: z.string().nullable(), error: z.string().nullable() }).strict();
export const runtimeHealthSchema = z.object({ name: z.string().min(1), supportsRunModel: z.boolean(), complete: z.boolean(), available: z.boolean(), sandboxed: z.boolean(), error: z.string().nullable() }).strict();
export const runtimeCompletionSchema = z.object({ text: z.string(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable() }).strict();
export const runtimeTranscriptSchema = z.array(z.discriminatedUnion("kind", [
  z.object({ id: z.string().optional(), at: z.string(), kind: z.literal("text"), text: z.string() }).strict(),
  z.object({ id: z.string().optional(), at: z.string(), kind: z.literal("tool"), tool: z.string(), args: z.string() }).strict(),
  z.object({ id: z.string().optional(), at: z.string(), kind: z.literal("result"), tool: z.string(), text: z.string(), error: z.boolean() }).strict(),
])).max(300);
export const runtimeImageSchema = z.object({ mime: z.string().max(200), base64: z.string().max(8 * 1024 * 1024) }).strict();
export const runtimeToolSchema = z.object({
  name: z.string().max(64), description: z.string(), parameters: z.record(z.string(), z.json()), reference: z.string().uuid(),
}).strict();
export const runtimeToolCallSchema = z.object({ name: z.string().max(200), args: z.record(z.string(), z.json()),
  key: z.string().min(1).max(200), timeoutSeconds: z.number().int().min(1).max(600).optional() }).strict();
export const runtimeStartSchema = z.object({
  operationId: runtimeOperationSchema.shape.operationId,
  runId: z.string().min(1).max(128), token: z.string().min(1).max(1024).optional(), lane: z.enum(["foreground", "background"]),
  cwd: z.string().min(1).max(8192), sessionDir: z.string().min(1).max(8192), sessionId: z.string().nullable(),
  prompt: z.string().max(2 * 1024 * 1024), systemPrompt: z.string().max(200_000), resources: z.enum(["configured", "minimal"]),
  /** null means no total Run time limit. */
  deadline: z.string().datetime({ offset: true }).nullable(), model: z.string().max(500).optional(),
  images: z.array(runtimeImageSchema).max(10).optional(), extraTools: z.array(z.string().max(200)).max(2000).optional(),
  searchTools: z.boolean().optional(), tools: z.array(runtimeToolSchema).max(100).optional(),
  hostPaths: z.array(z.string().max(8192)).max(1000).optional(),
  content: z.array(z.object({ name: z.string().max(200), dir: z.string().max(8192), writable: z.boolean() }).strict()).max(100).optional(),
  providerOptions: z.record(z.string(), z.json()).optional(),
  configurationRevision: z.string().min(1).max(128).optional(),
  callbacks: z.string().uuid().optional(),
}).strict();
export const runtimeEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("raw"), value: z.record(z.string(), z.json()) }).strict(),
  z.object({ kind: z.literal("settled"), operationId: runtimeOperationSchema.shape.operationId, outcome: runtimeOutcomeSchema }).strict(),
  z.object({ kind: z.literal("progress"), value: providerProgressSchema }).strict(),
  z.object({ kind: z.literal("usage"), value: providerUsageSchema }).strict(),
  z.object({ kind: z.literal("resources"), value: providerResourcesSchema }).strict(),
  z.object({ kind: z.literal("question"), requestId: z.string().uuid(), value: providerQuestionSchema }).strict(),
  z.object({ kind: z.literal("interrupt"), requestId: z.string().uuid() }).strict(),
]);
export type RuntimeStart = z.infer<typeof runtimeStartSchema>;
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

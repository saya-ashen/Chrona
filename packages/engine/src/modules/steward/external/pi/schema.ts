import { z } from "zod";
import { runtimeStartSchema, runtimeOperationSchema, runtimeOutcomeSchema, runtimeHealthSchema, runtimeCompletionSchema, runtimeTranscriptSchema, providerNativeInput, providerNativeOutput, THINKING_LEVELS } from "@chrona/contracts/steward";
import { configureInput, configureOutput, modelsInput, modelsOutput, modelSchema } from "./configuration";
export const completionInput = z.object({
  commandKey: z.string().min(1).max(128), configurationRevision: z.string().min(1).max(128).optional(), model: modelSchema.optional(), thinking: z.enum(THINKING_LEVELS).optional(),
  system: z.string().max(20_000).optional(), prompt: z.string().trim().min(1).max(200_000),
  maxOutputTokens: z.number().int().min(1).max(32_000), timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
}).strict();
export const runOptionsSchema = z.object({ model: modelSchema.optional(), thinking: z.enum(THINKING_LEVELS).optional() }).strict();
export const transcriptPageSchema = z.object({
  items: runtimeTranscriptSchema, nextCursor: z.string().max(16384).nullable(),
  gaps: z.array(z.object({ file: z.string().max(8192), offset: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), reason: z.enum(["record_too_large", "item_too_large"]), item: z.number().int().nonnegative().optional() }).strict()).max(300),
}).strict();
export const toolSchemas = {
  health: [z.object({}).strict(), runtimeHealthSchema],
  start: [runtimeStartSchema.extend({ callbacks: z.string().uuid() }), runtimeOperationSchema],
  status: [runtimeOperationSchema, runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean(), completion: runtimeCompletionSchema.optional() })],
  inject: [runtimeOperationSchema.extend({ message: z.string().max(2 * 1024 * 1024), images: runtimeStartSchema.shape.images }), z.object({ accepted: z.literal(true) }).strict()],
  abort: [runtimeOperationSchema, z.object({ requested: z.literal(true) }).strict()],
  release: [runtimeOperationSchema, z.object({ released: z.literal(true) }).strict()],
  transcript: [z.object({ sessionDir: z.string().min(1).max(8192), limit: z.number().int().min(1).max(300), page: z.literal(true).optional(), cursor: z.string().min(1).max(16384).optional() }).strict().refine(value => !value.cursor || value.page === true), z.union([runtimeTranscriptSchema, transcriptPageSchema])],
  native: [providerNativeInput, providerNativeOutput],
  complete: [completionInput, runtimeOperationSchema],
  configure: [configureInput, configureOutput], models: [modelsInput, modelsOutput],
} as const;
export type ToolName = keyof typeof toolSchemas;
export const isTool = (name: string): name is ToolName => Object.hasOwn(toolSchemas, name);

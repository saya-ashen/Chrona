import { z } from "zod";
import { runtimeStartSchema, runtimeOperationSchema, runtimeOutcomeSchema, runtimeHealthSchema, runtimeCompletionSchema, runtimeTranscriptSchema, THINKING_LEVELS } from "@chrona/contracts/steward";
import { hardLimitsSchema } from "./model-policy";
const directCompletionInput = z.object({ model: z.string().min(1).max(500), thinking: z.enum(THINKING_LEVELS).optional(), system: z.string().max(200_000).optional(), prompt: z.string().max(2 * 1024 * 1024), maxOutputTokens: z.number().int().positive().max(32_000), timeoutMs: z.number().int().positive().max(300_000) }).strict();
const tierCompletionInput = directCompletionInput.omit({ model: true, thinking: true }).extend({ declaredTier: z.string().min(1).max(40), effectiveHardLimits: hardLimitsSchema, timeoutMs: z.number().int().positive().max(600_000) }).strict();
export const agentCompletionInput = z.union([directCompletionInput, tierCompletionInput]);
export const agentTools = [
  ["health", z.object({}).strict(), runtimeHealthSchema], ["start", runtimeStartSchema, runtimeOperationSchema],
  ["status", runtimeOperationSchema, runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean() })],
  ["inject", runtimeOperationSchema.extend({ message: z.string().max(2 * 1024 * 1024), images: runtimeStartSchema.shape.images }), z.object({ accepted: z.literal(true) }).strict()],
  ["abort", runtimeOperationSchema, z.object({ requested: z.literal(true) }).strict()], ["release", runtimeOperationSchema, z.object({ released: z.literal(true) }).strict()],
  ["complete", agentCompletionInput, runtimeOperationSchema],
  ["completion", runtimeOperationSchema, z.object({ result: runtimeCompletionSchema.nullable(), failure: z.boolean() }).strict()],
  ["transcript", z.object({ sessionDir: z.string().max(8192), limit: z.number().int().min(1).max(300) }).strict(), runtimeTranscriptSchema],
] as const;
export function agentInput(name: string, raw: unknown): Record<string, unknown> {
  const declaration = agentTools.find(([tool]) => tool === name);
  if (!declaration) throw new Error("Unknown Agent tool");
  return declaration[1].parse(raw);
}

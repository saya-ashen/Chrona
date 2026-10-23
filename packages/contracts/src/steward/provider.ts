import { z } from "zod";

const id = z.string().min(1).max(128);
const iso = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const providerPhaseSchema = z.enum(["thinking", "reading", "writing", "searching", "executing", "recovering", "waiting"]);
export const providerProgressSchema = z.object({ phase: providerPhaseSchema, tool: z.string().regex(/^[\w:.-]{1,100}$/).nullable() }).strict();
export const providerUsageSchema = z.object({
  scope: z.enum(["run", "session"]), input: count, output: count, cacheRead: count, cacheWrite: count, total: count,
  /** Pi-reported model estimate in USD, not an invoice or a budget authorization. */
  cost: z.number().finite().nonnegative(), contextTokens: count.nullable(), contextWindow: count.nullable(),
}).strict();
export const providerResourcesSchema = z.object({ version: z.string().max(40), skills: z.array(z.string().max(100)).max(50), extensions: count }).strict();
export const providerQuestionSchema = z.object({
  method: z.enum(["select", "confirm", "input", "editor"]), title: z.string().min(1).max(200),
  message: z.string().max(2000), options: z.array(z.string().max(300)).max(30),
  /** Editor-only original text: live memory/owner response only, never persisted or replayed. */
  prefill: z.string().max(8000).optional(),
  timeoutMs: z.number().int().positive().max(300_000),
}).strict().refine(question => question.method !== "select" || question.options.length > 0, "Select requires options")
  .refine(question => question.prefill === undefined || question.method === "editor", "Only editors can have prefilled text");
/** No credentials or persistent answer bodies. Select values are option indices, not arbitrary option text. */
export const providerAnswerSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("cancel") }).strict(),
  z.object({ decision: z.literal("submit"), value: z.union([z.boolean(), z.number().int().nonnegative(), z.string().max(8000)]) }).strict(),
]);
export const providerInteractionSchema = z.object({
  id, runId: id, sessionId: id.nullable(), question: providerQuestionSchema, createdAt: iso, expiresAt: iso,
  status: z.enum(["pending", "answered", "cancelled", "expired", "interrupted"]),
}).strict();
export const providerRunViewSchema = z.object({
  id, sessionId: id.nullable(), sessionTitle: z.string().max(200).nullable(), active: z.boolean(),
  status: z.string().max(40), progress: providerProgressSchema.nullable(), usage: providerUsageSchema.nullable(),
  resources: providerResourcesSchema.nullable(), interactions: z.array(providerInteractionSchema).max(12), updatedAt: iso,
}).strict();
export type ProviderProgress = z.infer<typeof providerProgressSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type ProviderResources = z.infer<typeof providerResourcesSchema>;
export type ProviderQuestion = z.infer<typeof providerQuestionSchema>;
export type ProviderAnswer = z.infer<typeof providerAnswerSchema>;
export type ProviderInteraction = z.infer<typeof providerInteractionSchema>;
export type ProviderRunView = z.infer<typeof providerRunViewSchema>;
export type ProviderEvents = {
  progress(value: ProviderProgress): Promise<void>;
  usage(value: ProviderUsage): Promise<void>;
  resources(value: ProviderResources): Promise<void>;
  question(value: ProviderQuestion, signal: AbortSignal): Promise<ProviderAnswer>;
};

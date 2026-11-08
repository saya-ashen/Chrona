import { z } from "zod";
import { executionIdSchema, runtimeTranscriptSchema, providerInteractionSchema } from "@chrona/contracts/steward";

const id = executionIdSchema;
const requestKey = z.string().min(1).max(200);
export const contextInput = z.object({ requestKey }).strict();
export const contextRunInput = z.object({ contextId: id, requestKey, prompt: z.string().trim().min(1).max(200_000), content: z.array(z.string().min(1).max(1000)).max(10).default([]), lane: z.enum(["foreground", "background"]).default("background"), tools: z.array(z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)).max(100).default([]) }).strict();
export const contextRunTarget = z.object({ runId: id }).strict();
export const contextWriteInput = contextRunTarget.extend({ requestKey, text: z.string().trim().min(1).max(20_000) });
export const contextInterruptInput = contextRunTarget.extend({ requestKey });
export const contextRespondInput = contextRunTarget.extend({ requestKey, questionId: id, answer: z.string().min(1).max(100_000) });
export const contextStreamInput = contextRunTarget.extend({ after: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) });
export const contextOutput = z.object({ contextId: id }).strict();
export const contextRunOutput = z.object({ runId: id, contextId: id, status: z.string(), active: z.boolean() }).strict();
export const contextStreamOutput = z.object({ items: z.array(z.object({ sequence: z.number().int(), at: z.string(), kind: z.string(), payload: z.unknown() }).strict()), after: z.number().int(), ended: z.boolean(), transcript: runtimeTranscriptSchema, interactions: z.array(providerInteractionSchema).max(12) }).strict();

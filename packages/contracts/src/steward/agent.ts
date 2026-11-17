import { z } from "zod";
import { routedTargetSchema } from "./kernel-api";
const agentIdSchema = z.string().min(1).max(128).regex(/^[\w:.-]+$/);

/** Requested reasoning effort; each Provider validates the levels it supports. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const hardLimitsSchema = z.object({ maxCallsPerEvent: z.number().int().positive(), maxOutputTokens: z.number().int().positive().max(32_000), eventTimeoutMs: z.number().int().positive().max(600_000) }).strict();
export type HardLimits = z.infer<typeof hardLimitsSchema>;

export const runToolResultSchema = z.object({
  runId: agentIdSchema, callId: agentIdSchema, target: routedTargetSchema, moduleId: agentIdSchema, hash: z.string().min(1),
  status: z.enum(["succeeded", "failed", "unknown"]), outputState: z.enum(["complete", "filtered", "omitted"]), output: z.json().nullable(),
}).strict();

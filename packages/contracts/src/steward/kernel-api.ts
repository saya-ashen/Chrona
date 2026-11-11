import { z } from "zod";
import { KERNEL_MODULE_NAMES, LOCAL_CAPABILITY_NAMES } from "./module-lifecycle";
export const routedTargetSchema = z.union([
  z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/).refine(value => [...KERNEL_MODULE_NAMES, ...LOCAL_CAPABILITY_NAMES].some(namespace => value.startsWith(`${namespace}.`)), "Applications must be addressed by moduleId"),
  z.object({ moduleId: z.string().min(1).max(128), tool: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/) }).strict(),
]);
export type RoutedTarget = z.infer<typeof routedTargetSchema>;

export const pageInput = z.object({ cursor: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
export const pageOutput = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item).max(100), nextCursor: z.string().nullable() }).strict();
export const wakeBudgetSchema = z.object({ minIntervalMs: z.number().int().min(1000).max(86_400_000).default(60_000), dailyLimit: z.number().int().min(0).max(100_000).default(1000), moduleDailyLimit: z.number().int().min(0).max(10_000).default(100) }).strict();
export const timerScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string().datetime({ offset: true }) }).strict(),
  z.object({ kind: z.literal("every"), milliseconds: z.number().int().min(1000).max(31_536_000_000) }).strict(),
]);
export const timerSetInput = z.object({ id: z.string().min(1).max(120), schedule: timerScheduleSchema, payload: z.json().optional() }).strict().refine(value => new TextEncoder().encode(JSON.stringify(value.payload ?? null)).byteLength <= 16_384, "Timer payload exceeds 16 KiB");
export const timerViewSchema = z.object({ id: z.string(), revision: z.string(), schedule: timerScheduleSchema, status: z.enum(["active", "running", "paused", "stale", "done", "cancelled", "failed", "unknown"]), nextAt: z.string().nullable(), lastResult: z.string().nullable() }).strict();
export const PUBLIC_CALL_ERRORS = ["invalid", "forbidden", "not_found", "conflict", "unavailable", "cycle", "failed", "unknown"] as const;
export const PUBLIC_CALL_REASONS = ["capacity", "budget_exceeded", "cursor_expired", "reauthorize", "unsupported", "unconfigured", "too_large", "timeout", "module_paused"] as const;
const operationBase = z.object({ operationId: z.string(), moduleId: z.string(), approvalId: z.string().optional(), result: z.json().optional() }).strict();
const operationError = z.object({ code: z.enum(PUBLIC_CALL_ERRORS), message: z.string() }).strict();
export const lifecycleOperationSchema = z.discriminatedUnion("status", [
  operationBase.extend({ status: z.literal("pending_approval"), approvalId: z.string() }),
  operationBase.extend({ status: z.literal("running") }),
  operationBase.extend({ status: z.literal("done") }),
  operationBase.extend({ status: z.literal("failed"), error: operationError }),
  operationBase.extend({ status: z.literal("unknown"), error: operationError.optional() }),
]);

import { z } from "zod";
import { routedTargetSchema } from "./kernel-api";
import { runtimeStartSchema, runtimeOperationSchema, runtimeOutcomeSchema, runtimeHealthSchema, runtimeCompletionSchema, runtimeTranscriptSchema } from "./local-runtime";
import { executionIdSchema } from "./execution";

/** Requested reasoning effort; each Provider validates the levels it supports. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const hardLimitsSchema = z.object({ maxCallsPerEvent: z.number().int().positive(), maxOutputTokens: z.number().int().positive().max(32_000), eventTimeoutMs: z.number().int().positive().max(600_000) }).strict();
export type HardLimits = z.infer<typeof hardLimitsSchema>;

export const agentTools = [
  ["health", z.object({}).strict(), runtimeHealthSchema], ["start", runtimeStartSchema, runtimeOperationSchema],
  ["status", runtimeOperationSchema, runtimeOperationSchema.extend({ outcome: runtimeOutcomeSchema.nullable(), failure: z.boolean() })],
  ["inject", runtimeOperationSchema.extend({ message: z.string().max(2 * 1024 * 1024), images: runtimeStartSchema.shape.images }), z.object({ accepted: z.literal(true) }).strict()],
  ["abort", runtimeOperationSchema, z.object({ requested: z.literal(true) }).strict()], ["release", runtimeOperationSchema, z.object({ released: z.literal(true) }).strict()],
  ["transcript", z.object({ sessionDir: z.string().max(8192), limit: z.number().int().min(1).max(300) }).strict(), runtimeTranscriptSchema],
] as const;
export function agentInput(name: string, raw: unknown): Record<string, unknown> {
  const declaration = agentTools.find(([tool]) => tool === name);
  if (!declaration) throw new Error("Unknown Agent tool");
  return declaration[1].parse(raw);
}

export const contextRunOutput = z.object({ runId: executionIdSchema, contextId: executionIdSchema, status: z.string(), active: z.boolean() }).strict();
export const runToolResultSchema = z.object({
  runId: executionIdSchema, callId: executionIdSchema, target: routedTargetSchema, moduleId: executionIdSchema, hash: z.string().min(1),
  status: z.enum(["succeeded", "failed", "unknown"]), outputState: z.enum(["complete", "filtered", "omitted"]), output: z.json().nullable(),
}).strict();
const operation = z.object({ operationId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const moduleAgentInputs = {
  health: z.object({}).strict(),
  complete: z.object({ commandKey: executionIdSchema, prompt: z.string().trim().min(1).max(200_000), system: z.string().max(20_000).optional(), maxOutputTokens: z.number().int().min(1).max(32_000) }).strict(),
  completion: operation,
};
export const moduleAgentOutputs = {
  health: runtimeHealthSchema,
  complete: operation,
  completion: z.object({ result: runtimeCompletionSchema.nullable(), failure: z.boolean(), unknown: z.boolean().optional() }).strict(),
};
export type ModuleAgentTool = keyof typeof moduleAgentInputs;
export function isModuleAgentTool(name: string): name is ModuleAgentTool { return Object.hasOwn(moduleAgentInputs, name); }
export function camelArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelArguments);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (Object.hasOwn(result, normalized)) throw new Error("invalid: Duplicate Agent argument");
    result[normalized] = camelArguments(child);
  }
  return result;
}
export function moduleAgentInput(name: string, raw: unknown) {
  if (!isModuleAgentTool(name)) throw new Error("forbidden: Agent tool is not available to modules");
  return moduleAgentInputs[name].parse(camelArguments(raw));
}

/** Host paths are registration input only; execution continues to require an opaque projectRef. */
export const projectsInput = z.object({
  action: z.enum(["list", "register", "create"]),
  path: z.string().min(1).max(8192).optional(),
  name: z.string().min(1).max(64).optional(),
}).strict().superRefine((input, ctx) => {
  const valid = input.action === "list" ? input.path === undefined && input.name === undefined
    : input.action === "register" ? input.path !== undefined && input.name === undefined
    : input.name !== undefined && input.path === undefined;
  if (!valid) ctx.addIssue({ code: "custom", message: "list takes no path/name; register requires only path; create requires only name" });
});
const identity = z.string().min(1).max(256);
export const projectPrincipal = z.object({
  workspaceId: identity,
  ownerId: z.literal("owner"),
  caller: z.object({ kind: z.literal("module"), moduleId: identity, hash: identity }).strict(),
}).strict();
export const projectView = z.object({ projectRef: identity, path: z.string().min(1).max(8192), label: z.string().min(1).max(8192) }).strict();
export const projectsOutput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), principal: projectPrincipal, projects: z.array(projectView).max(100) }).strict(),
  z.object({ action: z.literal("register"), principal: projectPrincipal, project: projectView }).strict(),
  z.object({ action: z.literal("create"), principal: projectPrincipal, project: projectView }).strict(),
]);

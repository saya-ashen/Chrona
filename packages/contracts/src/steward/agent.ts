import { z } from "zod";
import { runtimeStartSchema, runtimeOperationSchema, runtimeOutcomeSchema, runtimeHealthSchema, runtimeCompletionSchema, runtimeTranscriptSchema } from "./local-runtime";
import { providerInteractionSchema } from "./provider";
import { executionIdSchema, executionStartSchema, executionViewSchema, executionInputSchemas, executionResultSourceSchema } from "./execution";
import { localExecutionStartSchema, applicationExecutionStartSchema, kernelPlacementViewSchema, kernelLocationSchema, kernelCleanupInputSchema, kernelCleanupReceiptSchema } from "./kernel-execution";
import { executionResponseDataSchemas } from "./execution-events";

/** Pi's thinking levels (`pi --thinking`). */
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
export const runToolResultSchema = z.object({
  runId: id, callId: id, target: z.string().min(1), moduleId: id, hash: z.string().min(1), contractHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["succeeded", "failed", "unknown"]), outputState: z.enum(["complete", "filtered", "omitted"]), output: z.json().nullable(),
}).strict();
export const contextStreamOutput = z.object({ items: z.array(z.object({ sequence: z.number().int(), at: z.string(), kind: z.string(), payload: z.unknown() }).strict()), after: z.number().int(), ended: z.boolean(), transcript: runtimeTranscriptSchema, interactions: z.array(providerInteractionSchema).max(12) }).strict();

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


const target = z.object({ executionId: id, runId: id, attemptId: id }).strict();
/** Execution primitives contain no coding session, task graph or result-acceptance policy. */
export const primitiveInputs = {
  context: contextInput,
  run: z.union([contextRunInput, executionStartSchema.omit({ workId: true, commandKey: true, goal: true }).extend({ executionId: id, requestKey: id, prompt: executionStartSchema.shape.goal }), ...([localExecutionStartSchema, applicationExecutionStartSchema] as const).map(schema => schema.omit({ workId: true, commandKey: true, goal: true }).extend({ executionId: id, requestKey: id, prompt: executionStartSchema.shape.goal }))]),
  get: z.union([contextRunTarget, z.object({ executionId: id, runId: id.optional(), attemptId: id.optional() }).strict()]),
  lookup: z.object({ requestKey: id }).strict(),
  stream: z.union([contextStreamInput, target.extend({ cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).default(50) })]),
  write: z.union([contextWriteInput, target.extend({ requestKey: id, text: executionInputSchemas.send.shape.text })]),
  interrupt: z.union([contextInterruptInput, target.extend({ requestKey: id })]),
  respond: z.union([contextRespondInput, target.extend({ requestKey: id, questionId: id, answer: z.string().min(1).max(100_000) })]),
  inspect: target,
  placement: z.object({ executionId: id }).strict(),
  locations: z.object({ after: id.optional(), limit: z.number().int().min(1).max(100) }).strict(),
  cleanup: kernelCleanupInputSchema,
};
export const primitiveOutputs = {
  context: contextOutput,
  run: z.union([contextRunOutput, z.object({ execution: executionViewSchema, placement: kernelPlacementViewSchema.optional() }).strict()]),
  get: z.union([contextRunOutput, executionViewSchema]),
  lookup: executionViewSchema,
  stream: z.union([contextStreamOutput, executionResponseDataSchemas.events]),
  write: z.object({ accepted: z.literal(true) }).strict(),
  interrupt: z.union([contextRunOutput, executionViewSchema]),
  respond: z.union([
    z.object({ accepted: z.literal(true) }).strict(),
    z.object({ accepted: z.literal(false), error: z.object({ code: z.enum(["not_found", "conflict", "invalid", "forbidden", "capacity"]), message: z.string() }).strict() }).strict(),
  ]),
  inspect: z.object({ snapshot: executionResponseDataSchemas.snapshot, source: executionResultSourceSchema }).strict(),
  placement: kernelPlacementViewSchema,
  locations: z.object({ locations: z.array(kernelLocationSchema).max(100), after: id.nullable() }).strict(),
  cleanup: kernelCleanupReceiptSchema,
};
export type AgentPrimitive = keyof typeof primitiveInputs;
export function isAgentPrimitive(name: string): name is AgentPrimitive { return Object.hasOwn(primitiveInputs, name); }
export function primitiveInput(name: AgentPrimitive, raw: unknown) {
  // Use the same argument normalization as the other SDK entry points.
  return primitiveInputs[name].parse(camelArguments(raw));
}

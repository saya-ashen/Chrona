import { z } from "zod";
import { pageInput, pageOutput, routedTargetSchema } from "./kernel-api";
import { providerAnswerSchema, providerInteractionSchema } from "./provider";
import { runtimeTranscriptSchema } from "./local-runtime";

const id = z.string().min(1).max(128);
const tool = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);
/** Backend options are Provider-owned JSON; callers cannot supply kernel launch identity. */
export const providerOptionsSchema = z.record(z.string().max(200), z.json()).refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65_536, "Provider options exceed 64 KiB");
export const agentProviderCapabilitiesSchema = z.object({ conversation: z.boolean(), completion: z.boolean(), native: z.boolean(), images: z.boolean(), interactions: z.boolean(), resume: z.boolean(), liveTranscript: z.literal(true).optional() }).strict();
const inspectQuery = z.string().max(100).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);
const inspectFields = { query: inspectQuery, version: z.number().int().min(1).max(65535), args: providerOptionsSchema.default({}) };
const inspections = z.array(z.object({ query: inspectQuery, version: inspectFields.version, scope: z.enum(["provider", "run"]) }).strict()).max(40);
export const agentInspectInput = z.union([
  z.object({ providerId: id, ...inspectFields }).strict(),
  z.object({ runId: id, ...inspectFields }).strict(),
]);
export const providerInspectInput = z.object({ ...inspectFields, operationId: id.optional(), configurationRevision: id.optional() }).strict();
export const agentInspectOutput = z.object({ query: inspectQuery, version: inspectFields.version, data: providerOptionsSchema }).strict();

const modelId = z.string().min(1).max(500);
export const providerModelsV1 = z.object({ defaultModel: modelId.nullable(), nextCursor: z.string().min(1).max(600).nullable(), models: z.array(z.object({
  id: modelId, label: modelId, effort: z.object({ options: z.array(id).min(1).max(32), default: id.nullable() }).nullable(),
})).max(100) });
export const providerContextV1 = z.object({ windowTokens: z.number().int().positive().nullable(), usedTokens: z.number().int().nonnegative().nullable() });

export const agentProviderEndpointsSchema = z.object({ health: tool, start: tool, status: tool, inject: tool, abort: tool, release: tool, transcript: tool.optional(), native: tool.optional(), complete: tool.optional(), inspect: tool.optional() }).strict();
export const agentProviderRegisterInput = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), name: z.string().min(1).max(100), protocolVersion: z.literal(1),
  capabilities: agentProviderCapabilitiesSchema, endpoints: agentProviderEndpointsSchema, inspections: inspections.optional(),
  configuration: z.object({ tool, page: z.string().min(1).max(200).optional(), revision: z.string().min(1).max(128).optional() }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (!!value.inspections?.length !== !!value.endpoints.inspect) context.addIssue({ code: "custom", message: "Inspection declarations and endpoint must be provided together" });
  if (value.capabilities.liveTranscript && !value.endpoints.transcript) context.addIssue({ code: "custom", message: "Live transcripts require a transcript endpoint" });
  if (value.capabilities.native && !value.endpoints.native) context.addIssue({ code: "custom", message: "Native capability requires an endpoint" });
  if (value.capabilities.completion && !value.endpoints.complete) context.addIssue({ code: "custom", message: "Completion capability requires an endpoint" });
});
export const agentProviderViewSchema = z.object({
  id: z.string(), name: z.string(), protocolVersion: z.literal(1), moduleId: id, hash: z.string(), revision: z.string(),
  capabilities: agentProviderCapabilitiesSchema, endpoints: agentProviderEndpointsSchema, inspections: inspections.optional(),
  configuration: z.object({ tool, page: z.string().optional(), revision: z.string().min(1).max(128).optional() }).strict().optional(), available: z.boolean(),
}).strict();
export const agentRunViewSchema = z.object({ runId: id, contextId: id, status: z.string(), active: z.boolean() }).strict();
export const agentRunInput = z.object({
  providerId: z.string().min(1).max(64).optional(), contextId: id.optional(), prompt: z.string().trim().min(1).max(200_000),
  cwd: z.string().min(1).max(8192).optional(),
  content: z.array(z.string().min(1).max(1000)).max(10).default([]), lane: z.enum(["foreground", "background"]).default("background"),
  tools: z.array(routedTargetSchema).max(100).default([]), providerOptions: providerOptionsSchema.default({}), kind: z.enum(["conversation", "completion"]).default("conversation"),
}).strict();
export const agentReadInput = z.object({ runId: id, cursor: z.string().max(1000).optional(), limit: z.number().int().min(1).max(100).default(50), waitMs: z.number().int().min(0).max(30_000).default(0), view: z.enum(["normalized", "native"]).default("normalized"), live: z.literal(true).optional() }).strict();
export const agentWriteInput = z.object({ runId: id, input: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), text: z.string().trim().min(1).max(20_000) }).strict(),
  z.object({ kind: z.literal("answer"), questionId: id, answer: providerAnswerSchema }).strict(),
]) }).strict();
export const agentReadOutput = z.object({ run: agentRunViewSchema, items: z.array(z.object({ sequence: z.number().int().nonnegative(), at: z.string(), kind: z.string(), payload: z.json() }).strict()).max(100), nextCursor: z.string().nullable(), ended: z.boolean(), interactions: z.array(providerInteractionSchema).max(12), transcript: runtimeTranscriptSchema.optional(), transcriptState: z.object({ status: z.enum(["available", "pending", "unavailable"]), reason: z.string().optional() }).strict().optional() }).strict();
export const agentNativeInput = z.object({ runId: id, request: providerOptionsSchema }).strict();
export const providerNativeInput = z.object({ operationId: id, request: providerOptionsSchema }).strict();
export const providerNativeOutput = z.object({ response: providerOptionsSchema }).strict();
export const kernelAgentInputs = {
  register: agentProviderRegisterInput,
  providers: pageInput.extend({ id: z.string().min(1).max(64).optional() }),
  inspect: agentInspectInput, run: agentRunInput, read: agentReadInput, write: agentWriteInput,
  stop: z.object({ runId: id }).strict(), native: agentNativeInput,
};
export const kernelAgentOutputs = {
  register: agentProviderViewSchema, providers: pageOutput(agentProviderViewSchema), inspect: agentInspectOutput,
  run: agentRunViewSchema, read: agentReadOutput,
  write: z.object({ accepted: z.literal(true) }).strict(), stop: agentRunViewSchema.extend({ stopConfirmed: z.boolean() }), native: providerNativeOutput,
};
export type AgentProviderRegistration = z.infer<typeof agentProviderRegisterInput>;
export type AgentProviderView = z.infer<typeof agentProviderViewSchema>;
export type KernelAgentTool = keyof typeof kernelAgentInputs;

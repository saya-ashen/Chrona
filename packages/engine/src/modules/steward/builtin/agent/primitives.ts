import { z } from "zod";
import { runtimeTranscriptSchema, type ProviderTranscriptItem, executionIdSchema, executionStartSchema, executionStartV2Schema, executionViewSchema, executionInputSchemas, executionResultSourceSchema, executionPlacementViewSchema, workLocationSchema, workCleanupInputSchema, workCleanupReceiptSchema, editorResponseDataSchemas } from "@chrona/contracts/steward";
import { contextInput, contextRunInput, contextRunTarget, contextWriteInput, contextInterruptInput, contextRespondInput, contextStreamInput, contextOutput, contextRunOutput, contextStreamOutput } from "./context-contracts";
import { transcriptRedactor } from "../../../../../../integrations/src/steward/transcript-redaction";
import { camelArguments } from "./module-contracts";

const id = executionIdSchema;
const target = z.object({ executionId: id, runId: id, attemptId: id }).strict();
/** Execution primitives contain no coding session, task graph or result-acceptance policy. */
export const primitiveInputs = {
  context: contextInput,
  run: z.union([contextRunInput, executionStartSchema.omit({ workId: true, commandKey: true, goal: true }).extend({ executionId: id, requestKey: id, prompt: executionStartSchema.shape.goal }), executionStartV2Schema.omit({ workId: true, commandKey: true, goal: true }).extend({ executionId: id, requestKey: id, prompt: executionStartSchema.shape.goal })]),
  get: z.union([contextRunTarget, z.object({ executionId: id, runId: id.optional(), attemptId: id.optional() }).strict()]),
  lookup: z.object({ requestKey: id }).strict(),
  stream: z.union([contextStreamInput, target.extend({ cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).default(50) })]),
  write: z.union([contextWriteInput, target.extend({ requestKey: id, text: executionInputSchemas.send.shape.text })]),
  interrupt: z.union([contextInterruptInput, target.extend({ requestKey: id })]),
  respond: z.union([contextRespondInput, target.extend({ requestKey: id, questionId: id, answer: z.string().min(1).max(100_000) })]),
  inspect: target,
  placement: z.object({ executionId: id }).strict(),
  locations: z.object({ after: id.optional(), limit: z.number().int().min(1).max(100) }).strict(),
  cleanup: workCleanupInputSchema,
};
export const primitiveOutputs = {
  context: contextOutput,
  run: z.union([contextRunOutput, z.object({ execution: executionViewSchema, placement: executionPlacementViewSchema.optional() }).strict()]),
  get: z.union([contextRunOutput, executionViewSchema]),
  lookup: executionViewSchema,
  stream: z.union([contextStreamOutput, editorResponseDataSchemas.events]),
  write: z.object({ accepted: z.literal(true) }).strict(),
  interrupt: z.union([contextRunOutput, executionViewSchema]),
  respond: z.object({ accepted: z.literal(true) }).strict(),
  inspect: z.object({ snapshot: editorResponseDataSchemas.snapshot, source: executionResultSourceSchema }).strict(),
  placement: executionPlacementViewSchema,
  locations: z.object({ locations: z.array(workLocationSchema).max(100), after: id.nullable() }).strict(),
  cleanup: workCleanupReceiptSchema,
};
export type AgentPrimitive = keyof typeof primitiveInputs;
export function isAgentPrimitive(name: string): name is AgentPrimitive { return Object.hasOwn(primitiveInputs, name); }
export function primitiveInput(name: AgentPrimitive, raw: unknown) {
  // Use the same argument normalization as the other SDK entry points.
  return primitiveInputs[name].parse(camelArguments(raw));
}
export function createAgentPrimitives(call: (target: string, args: Record<string, unknown>) => Promise<unknown>, control: (name: string, args: { operationId: string; message?: string }) => Promise<unknown>, transcript: (input: { sessionDir: string; limit: number }) => Promise<ProviderTranscriptItem[]> = async () => []) {
  return async (name: AgentPrimitive, raw: unknown, callId: string) => {
    const args = primitiveInput(name, raw);
    const result = await call("runtime-callback.agent-admit", { callId, operation: name });
    if (name === "stream" && !("executionId" in args)) {
      const { transcript: descriptor, ...page } = z.object({ transcript: z.object({ sessionDir: z.string(), limit: z.number().int().min(1).max(100) }).strict() }).passthrough().parse(result);
      const redact = transcriptRedactor();
      const items = runtimeTranscriptSchema.parse(await transcript(descriptor)).slice(-descriptor.limit).map(item => item.kind === "tool"
        ? { ...item, args: redact(item.args, 500) }
        : { ...item, text: redact(item.text, item.kind === "text" ? 4000 : 2000) });
      return contextStreamOutput.parse({ ...page, transcript: items });
    }
    if (name !== "write" && name !== "interrupt") return result;
    if (!("executionId" in args)) {
      const admitted = z.object({ perform: z.boolean(), operationId: z.string(), result: z.unknown() }).parse(result);
      if (admitted.perform) await control(name === "write" ? "inject" : "abort", { operationId: admitted.operationId, ...(name === "write" ? { message: (args as unknown as { text: string }).text } : {}) });
      await call("runtime-callback.agent-admit", { callId, operation: name, settle: true });
      return name === "write" ? { accepted: true } : admitted.result;
    }
    const admitted = z.object({ perform: z.boolean(), operationId: z.string(), execution: executionViewSchema }).parse(result);
    if (admitted.perform) await control(name === "write" ? "inject" : "abort", { operationId: admitted.operationId, ...(name === "write" ? { message: (args as z.infer<typeof primitiveInputs.write>).text } : {}) });
    return name === "write" ? { accepted: true } : admitted.execution;
  };
}

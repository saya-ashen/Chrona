import { z } from "zod";
import { runtimeTranscriptSchema, type ProviderTranscriptItem, executionViewSchema, contextStreamOutput, primitiveInput, primitiveInputs, type AgentPrimitive } from "@chrona/contracts/steward";
import { transcriptRedactor } from "@chrona/logging/redaction";

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
    const isContext = !("executionId" in args);
    const admitted = isContext
      ? z.object({ perform: z.boolean(), operationId: z.string(), result: z.unknown() }).parse(result)
      : z.object({ perform: z.boolean(), operationId: z.string(), execution: executionViewSchema }).parse(result);
    if (admitted.perform) await control(name === "write" ? "inject" : "abort", { operationId: admitted.operationId, ...(name === "write" ? { message: (args as z.infer<typeof primitiveInputs.write>).text } : {}) });
    if (isContext) await call("runtime-callback.agent-admit", { callId, operation: name, settle: true });
    if (name === "write") return { accepted: true };
    return "execution" in admitted ? admitted.execution : admitted.result;
  };
}

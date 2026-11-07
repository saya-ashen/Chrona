import { z } from "zod";
import { executionStartSchema, executionViewSchema, editorResponseDataSchemas, runtimeHealthSchema, runtimeCompletionSchema } from "@chrona/contracts/steward";
const operation = z.object({ operationId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const moduleAgentInputs = {
  health: z.object({}).strict(),
  start: executionStartSchema,
  status: operation,
  inject: operation.extend({ commandKey: executionStartSchema.shape.commandKey, message: z.string().trim().min(1).max(20_000) }),
  abort: operation.extend({ commandKey: executionStartSchema.shape.commandKey }),
  release: operation,
  complete: z.object({ commandKey: executionStartSchema.shape.commandKey, prompt: z.string().trim().min(1).max(200_000), system: z.string().max(20_000).optional(), maxOutputTokens: z.number().int().min(1).max(32_000) }).strict(),
  completion: operation,
  transcript: operation.extend({ cursor: z.string().max(1024).optional(), limit: z.number().int().min(1).max(100).default(50) }),
};
export const moduleAgentOutputs = {
  health: runtimeHealthSchema,
  start: operation,
  status: operation.extend({ execution: executionViewSchema }),
  inject: z.object({ accepted: z.literal(true) }).strict(),
  abort: z.object({ requested: z.literal(true) }).strict(),
  release: z.object({ released: z.literal(true) }).strict(),
  complete: operation,
  completion: z.object({ result: runtimeCompletionSchema.nullable(), failure: z.boolean() }).strict(),
  transcript: editorResponseDataSchemas.events,
};
export type ModuleAgentTool = keyof typeof moduleAgentInputs;
function camelArguments(value: unknown): unknown {
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
  if (!Object.hasOwn(moduleAgentInputs, name)) throw new Error("Unknown Agent tool");
  return moduleAgentInputs[name as ModuleAgentTool].parse(camelArguments(raw));
}

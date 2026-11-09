import { z } from "zod";
import { executionIdSchema, runtimeHealthSchema, runtimeCompletionSchema } from "@chrona/contracts/steward";
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

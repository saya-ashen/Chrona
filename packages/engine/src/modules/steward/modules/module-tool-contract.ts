import { createHash } from "node:crypto";
import { z } from "zod";
import { compileModuleOutput } from "@chrona/contracts/steward";
import { StewardError } from "../errors";
import type { Tool } from "./module-call-types";
import type { SystemTool } from "./module-system-tool-types";
import systemTools from "../../../../../contracts/schemas/system-tools.json";
import { normalizedToolInputSchema } from "./module-tool-input";
export { normalizedToolInputSchema } from "./module-tool-input";

/** Object key insertion order is not part of a JSON contract; array order remains declared data. */
function canonicalContractJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
}
export type ToolContract = { input: Record<string, unknown>; output: Record<string, unknown> | boolean | null; visibility: string[]; idempotent: boolean };
/** JSON artifacts are the public system contract; Zod remains the runtime validator. */
export function committedToolContract(target: string): ToolContract {
  if (!Object.hasOwn(systemTools, target)) throw new Error(`Missing committed system tool contract: ${target}`);
  // Discovery callers receive fresh schema objects, as they did before generation moved to build time.
  return structuredClone((systemTools as Record<string, ToolContract>)[target]);
}
export function moduleToolContract(tool: Tool | SystemTool): ToolContract {
  if ("contractTarget" in tool && tool.contractTarget) return committedToolContract(tool.contractTarget);
  // Private synchronous host tools do not expose or persist a public callback contract.
  if ("input" in tool && tool.input || tool.output instanceof z.ZodType) throw new Error(`No committed public contract for system tool: ${tool.name}`);
  return { input: normalizedToolInputSchema(tool), output: tool.output ?? null, visibility: [...tool.visibility].sort(), idempotent: tool.idempotent };
}
/** Exact callback shape, independent of source/version hash and documentation. */
export function moduleCallbackContractHash(tool: Tool | SystemTool) {
  return createHash("sha256").update(canonicalContractJson(moduleToolContract(tool))).digest("hex");
}
function numericValidator(parameter: Extract<import("@chrona/contracts/steward").ModuleToolParameter, { type: "number" | "integer" }>) {
  let schema = parameter.type === "integer" ? z.number().int() : z.number();
  if (parameter.minimum !== undefined) schema = schema.min(parameter.minimum);
  if (parameter.maximum !== undefined) schema = schema.max(parameter.maximum);
  if (parameter.exclusiveMinimum !== undefined) schema = schema.gt(parameter.exclusiveMinimum);
  if (parameter.exclusiveMaximum !== undefined) schema = schema.lt(parameter.exclusiveMaximum);
  return schema;
}
function parameterValidator(parameter: import("@chrona/contracts/steward").ModuleToolParameter): z.ZodType {
  if ("anyOf" in parameter) return z.union(parameter.anyOf.map(parameterValidator));
  let schema: z.ZodType;
  switch (parameter.type) {
    case "string": schema = parameter.enum ? z.enum(parameter.enum as [string, ...string[]]) : z.string(); break;
    case "number": case "integer": schema = numericValidator(parameter); break;
    case "boolean": schema = z.boolean(); break;
    case "null": schema = z.null(); break;
    case "array": schema = z.array(parameterValidator(parameter.items)); break;
    case "object": schema = objectValidator(parameter); break;
    default: schema = z.union(parameter.type.map(type => type === "string" ? z.string() : type === "number" ? z.number() : type === "boolean" ? z.boolean() : z.null()));
  }
  return parameter.description ? schema.describe(parameter.description) : schema;
}
function objectValidator(parameter: Extract<import("@chrona/contracts/steward").ModuleToolParameter, { type: "object" }>): z.ZodType {
  const properties = Object.fromEntries(Object.entries(parameter.properties).map(([key, value]) => {
    const schema = parameterValidator(value);
    return [key, (parameter.required ?? []).includes(key) ? schema : schema.optional()];
  }));
  return parameter.additionalProperties ? z.object(properties).catchall(z.unknown()) : z.object(properties).strict();
}
/** A module tool's arguments against its declared recursive parameters. */
export function validateToolArgs(tool: Tool, raw: unknown): Record<string, unknown> {
  const shape = Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, property]) => {
    const schema = parameterValidator(property);
    return [key, tool.parameters.required.includes(key) ? schema : schema.optional()];
  }));
  const parsed = z.object(shape).strict().safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map(issue => {
      const path = issue.path.map(part => String(part).replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(".");
      const keys = issue.code === "unrecognized_keys" ? issue.keys.slice(0, 5).map(key => key.replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(", ") : "";
      return `${path || keys || "$"} (${issue.code})`;
    });
    throw new StewardError("invalid", `Invalid tool arguments${issues.length ? `: ${issues.join("; ")}` : ""}`.slice(0, 500));
  }
  return parsed.data as Record<string, unknown>;
}
export function moduleToolExampleError(tool: Tool): string | null {
  for (const [index, example] of (tool.examples ?? []).entries()) {
    try { validateToolArgs(tool, example.args); }
    catch (cause) { return `Tool ${tool.name} example ${index + 1} arguments are invalid: ${cause instanceof Error ? cause.message : "check its input schema"}`; }
    if (Object.hasOwn(example, "result")) {
      const parsed = compileModuleOutput(tool.output).safeParse(example.result);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue.path.map(part => String(part).replace(/[^A-Za-z0-9_$-]/g, "?").slice(0, 40)).join(".") || "$";
        return `Tool ${tool.name} example ${index + 1} result does not match output schema at ${path} (${issue.code})`;
      }
    }
  }
  return null;
}

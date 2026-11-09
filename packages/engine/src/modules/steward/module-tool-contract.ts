import { createHash } from "node:crypto";
import { z } from "zod";
import { compileModuleOutput } from "@chrona/contracts/steward";
import { StewardError } from "./errors";
import type { Tool } from "./module-call-types";
import type { SystemTool } from "./module-system-types";

/** Object key insertion order is not part of a JSON contract; array order remains declared data. */
function canonicalContractJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
}
/** Exact callback shape, independent of source/version hash and documentation. */
export function moduleCallbackContractHash(tool: Tool | SystemTool) {
  const input = "input" in tool && tool.input ? z.toJSONSchema(tool.input) : normalizedToolInputSchema(tool);
  const output = tool.output instanceof z.ZodType ? z.toJSONSchema(tool.output) : tool.output ?? null;
  return createHash("sha256").update(canonicalContractJson({ input, output, visibility: [...tool.visibility].sort(), idempotent: tool.idempotent })).digest("hex");
}
function parameterValidator(parameter: import("@chrona/contracts/steward").ModuleToolParameter): z.ZodType {
  let schema: z.ZodType;
  switch (parameter.type) {
    case "string": schema = parameter.enum ? z.enum(parameter.enum as [string, ...string[]]) : z.string(); break;
    case "number": schema = z.number(); break;
    case "boolean": schema = z.boolean(); break;
    case "array": schema = z.array(parameterValidator(parameter.items)); break;
    case "object": schema = objectValidator(parameter); break;
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
      if (!tool.output) return `Tool ${tool.name} example ${index + 1} declares a result but the tool has no output schema`;
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
/** JSON Schema advertised to consumers mirrors runtime validation at every object boundary. */
export function normalizedToolInputSchema(tool: { parameters: Tool["parameters"] }) {
  const normalize = (parameter: import("@chrona/contracts/steward").ModuleToolParameter): Record<string, unknown> => {
    if (parameter.type === "array") return { type: "array", ...(parameter.description ? { description: parameter.description } : {}), items: normalize(parameter.items) };
    if (parameter.type === "object") return { type: "object", ...(parameter.description ? { description: parameter.description } : {}), properties: Object.fromEntries(Object.entries(parameter.properties).map(([key, value]) => [key, normalize(value)])), required: parameter.required ?? [], additionalProperties: parameter.additionalProperties };
    return { ...parameter };
  };
  return { type: "object", properties: Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, value]) => [key, normalize(value)])), required: tool.parameters.required, additionalProperties: false };
}

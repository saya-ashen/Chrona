import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentTools, moduleAgentInputs, moduleAgentOutputs, isModuleAgentTool, primitiveInputs, primitiveOutputs, projectsInput, projectsOutput } from "@chrona/contracts/steward";
import { configureInput, configureOutput } from "./model-policy";
function outputShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(outputShape);
  if (!value || typeof value !== "object") return value;
  const allowed = new Set(["type", "title", "description", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "allOf"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)).map(([key, child]) => [key, key === "properties" ? Object.fromEntries(Object.entries(child as object).map(([name, property]) => [name, outputShape(property)])) : outputShape(child)]));
}
const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
function objectParameters(schema: Record<string, unknown>) {
  return {
    properties: Object.fromEntries(Object.entries(schema.properties as object | undefined ?? {}).map(([key, child]) => [kebab(key), parameters(child)])),
    required: Array.isArray(schema.required) ? schema.required.map(value => kebab(String(value))) : [],
    ...(schema.additionalProperties && schema.additionalProperties !== false ? { additionalProperties: true } : {}),
  };
}
type Parameter = { type: unknown; properties?: Record<string, Parameter>; required?: string[]; items?: Parameter; additionalProperties?: boolean };
// The manifest has no input anyOf: admit the object union here, then let the SDK enforce its branches.
function unionParameters(shapes: Parameter[]): Parameter {
  const first = shapes[0];
  if (shapes.some(shape => shape.type !== first.type)) throw new Error("Incompatible Agent input parameter types");
  if (first.type === "object") {
    const names = [...new Set(shapes.flatMap(shape => Object.keys(shape.properties!)))];
    return { type: "object", properties: Object.fromEntries(names.map(name => [name, unionParameters(shapes.filter(shape => Object.hasOwn(shape.properties!, name)).map(shape => shape.properties![name]!))])), required: first.required!.filter(name => shapes.every(shape => shape.required!.includes(name))), ...(shapes.some(shape => shape.additionalProperties) ? { additionalProperties: true } : {}) };
  }
  if (first.type === "array") return { ...first, items: unionParameters(shapes.map(shape => shape.items!)) };
  return first;
}
export function parameters(value: unknown): Parameter {
  if (!value || typeof value !== "object") throw new Error("Invalid Agent input parameter");
  const schema = value as Record<string, unknown>;
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants)) return unionParameters(variants.map(parameters));
  return { type: schema.type === "integer" ? "number" : schema.type, ...(schema.type === "object" ? objectParameters(schema) : {}), ...(schema.items ? { items: parameters(schema.items) } : {}) };
}
const tools = [...agentTools.map(([name, _input, output]) => {
  if (!isModuleAgentTool(name)) return { name, description: `Agent ${name}: kernel-only execution control`, visibility: ["kernel"], parameters: { type: "object", properties: { input: { type: "string", description: "Kernel-only encoded request" } }, required: ["input"] }, output: outputShape(z.toJSONSchema(output)) };
  const publicInput = parameters(z.toJSONSchema(moduleAgentInputs[name])) as { properties: Record<string, unknown> };
  const result = { anyOf: [outputShape(z.toJSONSchema(output)), outputShape(z.toJSONSchema(moduleAgentOutputs[name]))] };
  return { name, description: `Agent ${name}: modules use structured arguments and own their operations; input is reserved for kernel calls`, visibility: ["kernel", "modules"], parameters: { type: "object", properties: { ...publicInput.properties, input: { type: "string", description: "Kernel-only encoded request" } }, required: [] }, output: result };
}), ...(["complete", "completion"] as const).map(name => ({ name, description: `Agent ${name}: application-owned completion`, visibility: ["modules"], parameters: parameters(z.toJSONSchema(moduleAgentInputs[name])), output: outputShape(z.toJSONSchema(moduleAgentOutputs[name])) }))];
const primitives = Object.entries(primitiveInputs).map(([name, input]) => {
  const shape = parameters(z.toJSONSchema(input));
  return { name, description: `Low-level Agent ${name}; caller owns business sessions and orchestration`, visibility: ["modules"], parameters: { type: "object", properties: shape.properties, required: [] }, output: outputShape(z.toJSONSchema(primitiveOutputs[name as keyof typeof primitiveOutputs])) };
});
export async function buildAgentApplication(outputDir = import.meta.dir) {
await writeFile(join(outputDir, "module.json"), JSON.stringify({ name: "agent", description: "Agent 执行：管理 Pi 进程、执行状态、补充指令与取消。随 Chrona 发行；应用通过普通调用提交工作并管理自己的操作。", entry: "index.ts", keepAlive: true, activated: true, uses: ["runtime-callback.event", "runtime-callback.agent-admit", "runtime-callback.agent-settle", "web.page-set"], effects: ["network"], data: { schema: 1 }, tests: ["test-entry.ts"], tools: [...tools, ...primitives, { name: "projects", description: "List, register or create host projects for the actual current approved owner application", visibility: ["modules"], parameters: parameters(z.toJSONSchema(projectsInput)), output: outputShape(z.toJSONSchema(projectsOutput)) }, { name: "configure", description: "Read or replace Agent model tiers, thinking levels and preferred completion timeout", visibility: ["owner"], parameters: parameters(z.toJSONSchema(configureInput)), output: outputShape(z.toJSONSchema(configureOutput)) }] }, null, 2) + "\n");
const result = await Bun.build({ entrypoints: [join(import.meta.dir, "runtime.ts"), join(import.meta.dir, "test.ts")], target: "bun", minify: true, external: ["chrona", "chrona/testing", "@chrona/contracts", "@chrona/contracts/*", "@chrona/logging", "@chrona/logging/*", "@chrona/pi", "zod"], outdir: outputDir, naming: "[name].js" });
if (!result.success) throw new AggregateError(result.logs, "Agent application build failed");
for (const name of ["runtime.js", "test.js"]) {
  const path = join(outputDir, name);
  await writeFile(path, (await readFile(path, "utf8")).replace(/[\t ]+$/gm, ""));
}
}
if (import.meta.main) await buildAgentApplication();

import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentTools } from "./contracts";
import { moduleAgentInputs, moduleAgentOutputs, type ModuleAgentTool } from "./module-contracts";
import { primitiveInputs, primitiveOutputs } from "./primitives";
function outputShape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(outputShape);
  if (!value || typeof value !== "object") return value;
  const allowed = new Set(["type", "title", "description", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "allOf"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)).map(([key, child]) => [key, key === "properties" ? Object.fromEntries(Object.entries(child as object).map(([name, property]) => [name, outputShape(property)])) : outputShape(child)]));
}
function parameters(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const schema = value as Record<string, unknown>;
  const kebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
  return { type: schema.type === "integer" ? "number" : schema.type, ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties as object).map(([key, child]) => [kebab(key), parameters(child)])), required: Array.isArray(schema.required) ? schema.required.map(value => kebab(String(value))) : [] } : {}), ...(schema.items ? { items: parameters(schema.items) } : {}) };
}
const tools = agentTools.map(([name, _input, output]) => {
  const publicInput = parameters(z.toJSONSchema(moduleAgentInputs[name as ModuleAgentTool])) as { properties: Record<string, unknown> };
  const result = { anyOf: [outputShape(z.toJSONSchema(output)), outputShape(z.toJSONSchema(moduleAgentOutputs[name as ModuleAgentTool]))] };
  return { name, description: `Agent ${name}: modules use structured arguments and own their operations; input is reserved for kernel calls`, visibility: ["kernel", "modules"], parameters: { type: "object", properties: { ...publicInput.properties, input: { type: "string", description: "Kernel-only encoded request" } }, required: [] }, output: result };
});
const primitives = Object.entries(primitiveInputs).map(([name, input]) => {
  const raw = z.toJSONSchema(input) as { anyOf?: unknown[] };
  const shapes = (raw.anyOf ?? [raw]).map(value => parameters(value) as { properties: Record<string, unknown> });
  return { name, description: `Low-level Agent ${name}; caller owns business sessions and orchestration`, visibility: ["modules"], parameters: { type: "object", properties: Object.assign({}, ...shapes.map(shape => shape.properties)), required: [] }, output: outputShape(z.toJSONSchema(primitiveOutputs[name as keyof typeof primitiveOutputs])) };
});
export async function buildAgentApplication(outputDir = import.meta.dir) {
await writeFile(join(outputDir, "module.json"), JSON.stringify({ name: "agent", description: "Agent 执行：管理 Pi 进程、执行状态、补充指令与取消。随 Chrona 发行；应用通过普通调用提交工作并管理自己的操作。", entry: "index.ts", keepAlive: true, healthCheck: true, limits: { virtualMemoryMb: 8192 }, uses: ["runtime-callback.event", "runtime-callback.agent-admit", "runtime-callback.agent-settle", "modules.report-health"], triggers: [], effects: ["network"], data: { schema: 1 }, tests: ["test-entry.ts"], tools: [...tools, ...primitives] }, null, 2) + "\n");
const result = await Bun.build({ entrypoints: [join(import.meta.dir, "runtime.ts"), join(import.meta.dir, "test.ts")], target: "bun", external: ["chrona", "chrona/testing"], outdir: outputDir, naming: "[name].js" });
if (!result.success) throw new AggregateError(result.logs, "Agent application build failed");
for (const name of ["runtime.js", "test.js"]) {
  const path = join(outputDir, name);
  await writeFile(path, (await readFile(path, "utf8")).replace(/[\t ]+$/gm, ""));
}
}
if (import.meta.main) await buildAgentApplication();

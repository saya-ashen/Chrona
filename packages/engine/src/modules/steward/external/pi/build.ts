import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { toolSchemas } from "./schema";

/** Manifest structural subset. Runtime Zod schemas still enforce bounds and strict branches. */
export function parameters(raw: unknown): Record<string, unknown> {
  const schema = raw as Record<string, unknown>;
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf.map(parameters) };
  if (schema.type === "object") return { type: "object", properties: Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, parameters(child)])), required: schema.required ?? [], additionalProperties: !!schema.additionalProperties };
  if (schema.type === "array") return { type: "array", items: parameters(schema.items) };
  if (["string", "integer", "number", "boolean", "null"].includes(String(schema.type))) return { type: schema.type === "integer" ? "number" : schema.type, ...(schema.enum ? { enum: schema.enum } : {}) };
  throw new Error("Unsupported Pi input schema");
}
export function outputShape(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(outputShape);
  if (!raw || typeof raw !== "object") return raw;
  const schema = raw as Record<string, unknown>, output: Record<string, unknown> = {};
  for (const key of ["type", "title", "description", "required", "enum", "const", "anyOf", "allOf", "items"]) if (key in schema) output[key] = outputShape(schema[key]);
  if (schema.properties) output.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, outputShape(value)]));
  if (schema.additionalProperties !== undefined) output.additionalProperties = typeof schema.additionalProperties === "object" ? true : schema.additionalProperties;
  return output;
}
export function manifest() {
  return { name: "pi", description: "Pi 执行提供方：管理进程、会话、原生协议和当前用户的配置资源。可选预装应用。", entry: "index.ts", keepAlive: true, activated: true,
    uses: ["agent.register", "runtime-callback.event", "web.page-set"], effects: ["network"], data: { schema: 1 }, tests: ["test-entry.ts"],
    tools: Object.entries(toolSchemas).map(([name, [input, output]]) => {
      const shape = parameters(z.toJSONSchema(input, { io: "input" }));
      // The manifest root is closed by the module tool contract itself.
      delete shape.additionalProperties;
      return { name, description: name === "configure" ? "读取或替换当前用户的 Pi 配置目录、模型和思考强度" : name === "models" ? "从所选本地 Pi 配置发现模型选项，不调用模型" : `Pi ${name}: kernel-bound provider endpoint`,
        visibility: [name === "configure" || name === "models" ? "owner" : "kernel"], parameters: shape, output: outputShape(z.toJSONSchema(output)) };
    }),
  };
}
export async function buildPiApplication(outputDir = import.meta.dir) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "module.json"), JSON.stringify(manifest(), null, 2) + "\n");
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, "runtime.ts"), join(import.meta.dir, "test.ts")], target: "bun", minify: true,
    external: ["chrona", "@chrona/contracts", "@chrona/contracts/*", "@chrona/logging", "@chrona/logging/*", "@chrona/pi", "zod"], outdir: outputDir, naming: "[name].js" });
  if (!result.success) throw new AggregateError(result.logs, "Pi module build failed");
  for (const name of ["runtime.js", "test.js"]) {
    const path = join(outputDir, name); await writeFile(path, (await readFile(path, "utf8")).replace(/[\t ]+$/gm, ""));
  }
  await writeFile(join(outputDir, "index.ts"), 'import "./runtime.js";\n');
  await writeFile(join(outputDir, "test-entry.ts"), 'import "./test.js";\n');
}
if (import.meta.main) await buildPiApplication(process.argv[2] ?? import.meta.dir);

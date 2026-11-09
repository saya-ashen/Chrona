import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { publicSystemTools } from "./system/tool-contract-declarations";
import { moduleCallbackContractHash, normalizedToolInputSchema } from "./module-tool-contract";
import type { Tool } from "./module-call-types";
import type { SystemTool } from "./module-system-types";

export const repositoryRoot = resolve(import.meta.dirname, "../../../../..");
export const baselineDirectory = join(repositoryRoot, "packages/contracts/fixtures");
const moduleRoot = join(repositoryRoot, "packages/engine/src/modules/steward");
const moduleToolsSchema = moduleManifestSchema.shape.tools;

export async function readAgentTools(): Promise<unknown> {
  const manifest = JSON.parse(await readFile(join(moduleRoot, "builtin/agent/module.json"), "utf8"));
  return manifest.tools;
}

/** Include retained paused applications: persisted bindings are independent of runtime availability. */
export async function collectContractHashes() {
  const hashes: Record<string, string> = {};
  const add = (name: string, tools: (Tool | SystemTool)[]) => {
    for (const tool of tools) {
      const target = `${name}.${tool.name}`;
      if (Object.hasOwn(hashes, target)) throw new Error(`Duplicate contract target: ${target}`);
      hashes[target] = moduleCallbackContractHash(tool);
    }
  };
  for (const [name, tools] of Object.entries(publicSystemTools)) add(name, tools);
  add("agent", moduleToolsSchema.parse(await readAgentTools()));
  const externalRoot = join(moduleRoot, "external");
  for (const directory of (await readdir(externalRoot, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!directory.isDirectory()) continue;
    let text: string;
    try { text = await readFile(join(externalRoot, directory.name, "module.json"), "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const manifest = JSON.parse(text);
    add(z.string().parse(manifest.name), moduleToolsSchema.parse(manifest.tools));
  }
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/** Data-only cases for another language to consume, including normalized input and serialized preimage. */
export function syntheticContracts() {
  const base = moduleToolsSchema.parse([{
    name: "nested", description: "Documentation is excluded from the digest", visibility: ["owner", "modules"], idempotent: true,
    parameters: { type: "object", properties: {
      payload: { type: "object", properties: {
        "中文": { type: "array", description: "嵌套 🕒", items: { type: "object", properties: { flag: { type: "boolean" }, choice: { type: "string", enum: ["é", "中文", "🕒"] } }, required: ["choice", "flag"] } },
        "\ue000": { type: "number" }, "😀": { type: "string" }, "10": { type: "number" }, "2": { type: "number" },
      }, required: ["中文", "😀"] },
      count: { type: "number" },
    }, required: ["payload", "count"] },
    output: { type: "object", properties: {
      values: { type: "array", items: { enum: [0, -0, 1, -42, 1.5, 1e-7, 1e21, 9007199254740991, null, "中文\n🕒"] } },
    }, required: ["values"], additionalProperties: false },
  }])[0]!;
  const cases: { name: string; tool: Tool }[] = [
    { name: "unicode-numbers-nested", tool: base },
    { name: "visibility-reversed", tool: { ...base, visibility: [...base.visibility].reverse() } },
    { name: "required-reversed", tool: { ...base, parameters: { ...base.parameters, required: [...base.parameters.required].reverse() } } },
    { name: "enum-reversed", tool: { ...base, output: { type: "string", enum: ["🕒", "中文", "é"] } } },
    { name: "enum-forward", tool: { ...base, output: { type: "string", enum: ["é", "中文", "🕒"] } } },
    { name: "undeclared-output", tool: { ...base, output: undefined, idempotent: false } },
  ];
  return cases.map(({ name, tool }) => {
    const contract = { input: normalizedToolInputSchema(tool), output: tool.output ?? null, visibility: [...tool.visibility].sort(), idempotent: tool.idempotent };
    // This is the captured preimage, not the implementation used by the assertion.
    const canonicalJson = JSON.stringify(contract, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
    return { name, tool, contract, canonicalJson, contractHash: moduleCallbackContractHash(tool) };
  });
}

if (import.meta.main) {
  if (process.argv[2] !== "--write-baseline") throw new Error("Baseline capture requires --write-baseline; never regenerate to accept an unexplained hash change");
  const fixtures = [
    ["contract-hashes.json", await collectContractHashes()],
    ["agent-tools.json", await readAgentTools()],
    ["contract-hash-cases.json", syntheticContracts()],
  ] as const;
  for (const [name, value] of fixtures) await writeFile(join(baselineDirectory, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`Captured ${Object.keys(fixtures[0][1]).length} tool hashes and ${fixtures[2][1].length} synthetic contracts`);
}

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { chronaToolInputSchemas, moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleWireMessageSchema, moduleWireTransport } from "../packages/contracts/src/steward/module-wire";
import { publicSystemTools } from "../packages/engine/src/modules/steward/system/tool-contract-declarations";
import { normalizedToolInputSchema } from "../packages/engine/src/modules/steward/modules/module-tool-input";

export const contractSchemasDirectory = resolve(import.meta.dirname, "../packages/contracts/schemas");

/** Public declarations only: do not import host registration, Agent or application runtimes here. */
export function generateContractSchemas() {
  const systemTools = Object.fromEntries(Object.entries(publicSystemTools).flatMap(([namespace, tools]) => tools.map(tool => [
    `${namespace}.${tool.name}`,
    { input: tool.input ? z.toJSONSchema(tool.input, { io: "input" }) : normalizedToolInputSchema(tool),
      output: tool.output ? z.toJSONSchema(tool.output) : null,
      visibility: [...tool.visibility].sort(), idempotent: tool.idempotent },
  ])));
  // The public build response tool has no module handler or application runtime.
  systemTools.chrona_reply = { input: z.toJSONSchema(chronaToolInputSchemas.chrona_reply, { io: "input" }), output: null, visibility: ["provider"], idempotent: false };
  return {
    "system-tools.json": systemTools,
    "module-wire.json": { ...z.toJSONSchema(moduleWireMessageSchema, { io: "input", unrepresentable: "any" }), $id: "https://chrona.local/contracts/module-wire.json", title: "Chrona module wire protocol v1", "x-chrona-transport": moduleWireTransport },
    "module-manifest.json": z.toJSONSchema(moduleManifestSchema, { io: "input", unrepresentable: "any" }),
  };
}

export const serializeContractSchema = (schema: unknown) => `${JSON.stringify(schema, null, 2)}\n`;

if (import.meta.main) {
  const check = process.argv.includes("--check");
  if (!check) await mkdir(contractSchemasDirectory, { recursive: true });
  for (const [name, schema] of Object.entries(generateContractSchemas())) {
    const path = resolve(contractSchemasDirectory, name), expected = serializeContractSchema(schema);
    if (check) {
      if (await readFile(path, "utf8") !== expected) throw new Error(`${name} is stale; run bun scripts/generate-contract-schemas.ts`);
    } else await writeFile(path, expected);
  }
}

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { publicSystemTools } from "../packages/engine/src/modules/steward/system/tool-contract-declarations";
import { committedToolContract, moduleCallbackContractHash, moduleToolContract } from "../packages/engine/src/modules/steward/module-tool-contract";
import { contractSchemasDirectory, generateContractSchemas, serializeContractSchema } from "./generate-contract-schemas";

const schemas = generateContractSchemas();
for (const [name, schema] of Object.entries(schemas)) {
  test(`committed ${name} exactly matches its public build sources`, async () => {
    expect(await readFile(resolve(contractSchemasDirectory, name), "utf8")).toBe(serializeContractSchema(schema));
  });
}

test("system artifact contains only the seven public namespaces and the public build response tool", () => {
  const targets = Object.entries(publicSystemTools).flatMap(([namespace, tools]) => tools.map(tool => `${namespace}.${tool.name}`));
  expect(Object.keys(schemas["system-tools.json"]).sort()).toEqual([...targets, "chrona_reply"].sort());
  expect(Object.keys(publicSystemTools).sort()).toEqual(["activity", "agent", "approvals", "modules", "secrets", "settings", "timers"]);
});

test("runtime discovery and hashing use committed JSON without evaluating Zod", () => {
  const tool = publicSystemTools.modules.find(tool => tool.name === "health")!;
  const unavailable = z.lazy(() => { throw new Error("Runtime Zod schema conversion must not run"); });
  const opaque = { ...tool, input: unavailable, output: unavailable };
  expect(moduleToolContract(opaque)).toEqual(schemas["system-tools.json"]["modules.health"]);
  expect(moduleCallbackContractHash(opaque)).toBe(moduleCallbackContractHash(tool));
  expect(() => committedToolContract("runtime-workspace.prepare")).toThrow("Missing committed system tool contract");
  expect(() => committedToolContract("toString")).toThrow("Missing committed system tool contract");
});

test("discovery consumers cannot mutate subsequent frozen contracts or hashes", () => {
  const tool = publicSystemTools.modules.find(tool => tool.name === "health")!;
  const before = moduleCallbackContractHash(tool);
  const contract = moduleToolContract(tool);
  (contract.input.properties as Record<string, unknown>).module = { type: "number" };
  contract.visibility.reverse();
  expect(moduleCallbackContractHash(tool)).toBe(before);
  expect(moduleToolContract(tool)).toEqual(schemas["system-tools.json"]["modules.health"]);
});

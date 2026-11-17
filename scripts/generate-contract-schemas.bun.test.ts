import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { publicSystemTools } from "../packages/kernel/src/system/tool-contract-declarations";
import { committedToolContract, moduleCallbackContractHash, moduleToolContract } from "../packages/kernel/src/modules/module-tool-contract";
import { contractSchemasDirectory, generateContractSchemas, serializeContractSchema } from "./generate-contract-schemas";

const schemas = generateContractSchemas();
for (const [name, schema] of Object.entries(schemas)) {
  test(`committed ${name} exactly matches its public build sources`, async () => {
    expect(await readFile(resolve(contractSchemasDirectory, name), "utf8")).toBe(serializeContractSchema(schema));
  });
}

test("system artifact contains only tools from the seven public namespaces", () => {
  const targets = Object.entries(publicSystemTools).flatMap(([namespace, tools]) => tools.map(tool => `${namespace}.${tool.name}`));
  expect(Object.keys(schemas["system-tools.json"]).sort()).toEqual(targets.sort());
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

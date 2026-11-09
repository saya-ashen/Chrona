import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import hashes from "../packages/contracts/fixtures/contract-hashes.json";
import transitions from "../packages/contracts/fixtures/contract-hash-transitions.json";
import { publicSystemTools } from "../packages/engine/src/modules/steward/system/tool-contract-declarations";
import { committedToolContract, moduleCallbackContractHash, moduleToolContract } from "../packages/engine/src/modules/steward/module-tool-contract";
import { contractSchemasDirectory, generateContractSchemas, serializeContractSchema } from "./generate-contract-schemas";

const schemas = generateContractSchemas();
for (const [name, schema] of Object.entries(schemas)) {
  test(`committed ${name} exactly matches its public build sources`, async () => {
    expect(await readFile(resolve(contractSchemasDirectory, name), "utf8")).toBe(serializeContractSchema(schema));
  });
}

test("system artifact contains only the five public namespaces and the public build response tool", () => {
  const targets = Object.entries(publicSystemTools).flatMap(([namespace, tools]) => tools.map(tool => `${namespace}.${tool.name}`));
  expect(Object.keys(schemas["system-tools.json"]).sort()).toEqual([...targets, "chrona_reply"].sort());
  expect(Object.keys(publicSystemTools).sort()).toEqual(["activity", "approvals", "modules", "secrets", "settings"]);
});

test("freshly generated system contracts preserve the independent S0 hashes and explicit transitions", () => {
  const expected: Record<string, string> = { ...hashes };
  for (const transition of transitions) expected[transition.target] = transition.after;
  for (const [target, contract] of Object.entries(schemas["system-tools.json"])) {
    if (target === "chrona_reply") continue;
    // Hash the newly generated tuple independently of the runtime's committed lookup.
    const { input, output, visibility, idempotent } = contract;
    const canonical = JSON.stringify({ input, output, visibility, idempotent }, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
    expect(new Bun.CryptoHasher("sha256").update(canonical).digest("hex")).toBe(expected[target]);
  }
});

test("runtime discovery and hashing use committed JSON without evaluating Zod", () => {
  const tool = publicSystemTools.modules.find(tool => tool.name === "diagnostics")!;
  const unavailable = z.lazy(() => { throw new Error("Runtime Zod schema conversion must not run"); });
  const opaque = { ...tool, input: unavailable, output: unavailable };
  expect(moduleToolContract(opaque)).toEqual(schemas["system-tools.json"]["modules.diagnostics"]);
  expect(moduleCallbackContractHash(opaque)).toBe(moduleCallbackContractHash(tool));
  expect(() => committedToolContract("runtime-workspace.prepare")).toThrow("Missing committed system tool contract");
  expect(() => committedToolContract("toString")).toThrow("Missing committed system tool contract");
});

test("discovery consumers cannot mutate subsequent frozen contracts or hashes", () => {
  const tool = publicSystemTools.modules.find(tool => tool.name === "diagnostics")!;
  const before = moduleCallbackContractHash(tool);
  const contract = moduleToolContract(tool);
  (contract.input.properties as Record<string, unknown>).module = { type: "number" };
  contract.visibility.reverse();
  expect(moduleCallbackContractHash(tool)).toBe(before);
  expect(moduleToolContract(tool)).toEqual(schemas["system-tools.json"]["modules.diagnostics"]);
});

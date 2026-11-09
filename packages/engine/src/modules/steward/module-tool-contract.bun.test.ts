import { expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { moduleCallbackContractHash } from "./module-tool-contract";

const tool = moduleManifestSchema.parse({
  name: "callback", entry: "index.ts", tests: ["test.ts"], effects: [],
  tools: [{
    name: "read", description: "Original documentation", visibility: ["owner", "modules"], idempotent: true,
    parameters: { type: "object", properties: { aa: { type: "number" }, zz: { type: "string" } }, required: ["zz"] },
    output: { type: "object", properties: { b: { type: "boolean" }, A: { type: "integer" } }, required: ["A"], additionalProperties: false },
  }],
}).tools[0]!;

test("extracted callback hashing preserves the persisted canonical digest", () => {
  // Frozen binding value: changing this digest would invalidate saved callback identities.
  const digest = "196381e29455454c732c94a8804d318a474cfc21f027255bce593a13b7d0753c";
  expect(moduleCallbackContractHash(tool)).toBe(digest);
  expect(moduleCallbackContractHash({ ...tool, name: "renamed", description: "Updated documentation", visibility: ["modules", "owner"],
    parameters: { type: "object", properties: { zz: { type: "string" }, aa: { type: "number" } }, required: ["zz"] },
    output: { additionalProperties: false, required: ["A"], properties: { A: { type: "integer" }, b: { type: "boolean" } }, type: "object" },
  })).toBe(digest);
  expect(moduleCallbackContractHash({ ...tool, idempotent: false })).not.toBe(digest);
  expect(moduleCallbackContractHash({ ...tool, visibility: ["owner"] })).not.toBe(digest);
});

test("callback hashes retain declared array order while canonicalizing object keys", () => {
  const forward = { ...tool, parameters: { ...tool.parameters, required: ["zz", "aa"] } };
  const reverse = { ...tool, parameters: { ...tool.parameters, required: ["aa", "zz"] } };
  expect(moduleCallbackContractHash(forward)).not.toBe(moduleCallbackContractHash(reverse));
});

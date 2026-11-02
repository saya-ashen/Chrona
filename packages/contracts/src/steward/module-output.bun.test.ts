import { expect, test } from "bun:test";
import { compileModuleOutput, moduleOutputSchema } from "./module-output";
import { moduleManifestSchema } from "./index";

test("output contracts compile once and validate nested records and unions", () => {
  const schema = moduleOutputSchema.parse({ type: "object", properties: {
    rows: { type: "array", items: { type: "object", additionalProperties: { anyOf: [{ type: "string" }, { type: "null" }] } } },
  }, required: ["rows"], additionalProperties: false });
  const validator = compileModuleOutput(schema);
  expect(compileModuleOutput(schema)).toBe(validator);
  expect(validator.safeParse({ rows: [{ name: "ok", missing: null }] }).success).toBe(true);
  expect(validator.safeParse({ rows: [{ name: 42 }] }).success).toBe(false);
  expect(validator.safeParse({}).success).toBe(false);
});

test.each([
  { $ref: "https://example.invalid/schema" },
  { type: "object", properties: { nested: { $ref: "#/$defs/x" } } },
  { type: "string", pattern: ".*" },
  { type: "bogus" },
  { anyOf: [] },
  { type: "object", required: ["id"] },
  { type: "object", properties: { row: { type: "object", required: ["id"] } } },
  { type: "array", items: false },
  { description: "x".repeat(8001) },
])("unsupported or oversized output contracts are rejected: %j", schema => {
  expect(moduleOutputSchema.safeParse(schema).success).toBe(false);
});

test("legacy tool output stays optional in stored manifests", () => {
  const manifest = { name: "fixture", entry: "index.ts", triggers: [], effects: [], tests: ["test.ts"], tools: [
    { name: "get", description: "Read", parameters: { type: "object" } },
  ] };
  expect(moduleManifestSchema.parse(manifest).tools[0]!.output).toBeUndefined();
  expect(moduleManifestSchema.parse({ ...manifest, tools: [{ ...manifest.tools[0], output: { type: "string" } }] }).tools[0]!.output).toEqual({ type: "string" });
});

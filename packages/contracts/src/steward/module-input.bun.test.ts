import { expect, test } from "bun:test";
import { moduleToolParameterSchema, moduleToolParametersSchema } from "./module-input";

test("structured parameters retain array/object shape and explicit nested closed-object semantics", () => {
  const schema = moduleToolParameterSchema.parse({ type: "array", items: { type: "object", properties: { item_id: { type: "string" } }, required: ["item_id"] } });
  expect(schema).toMatchObject({ type: "array", items: { type: "object", additionalProperties: false, required: ["item_id"] } });
});
test("parameter schema rejects missing items, dangling required fields and excessive depth", () => {
  expect(moduleToolParameterSchema.safeParse({ type: "array" }).success).toBe(false);
  expect(moduleToolParameterSchema.safeParse({ type: "object", properties: {}, required: ["missing"] }).success).toBe(false);
  let schema: unknown = { type: "string" };
  for (let i = 0; i < 30; i++) schema = { type: "array", items: schema };
  expect(moduleToolParameterSchema.safeParse(schema).success).toBe(false);
});
test("input budgets cover all properties together and retain practical numeric constraints", () => {
  const numeric = { type: "integer", minimum: 0, maximum: 100 } as const;
  expect(moduleToolParameterSchema.parse(numeric)).toEqual(numeric);
  expect(moduleToolParameterSchema.safeParse({ type: "string", enum: Array.from({ length: 21 }, (_, i) => String(i)) }).success).toBe(true);
  expect(moduleToolParametersSchema.safeParse({ type: "object", properties: {}, required: ["missing"] }).success).toBe(false);
  const properties = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`field${i}`, { type: "string" }]));
  expect(moduleToolParametersSchema.safeParse({ type: "object", properties }).success).toBe(false);
  const enumValues = Array.from({ length: 700 }, (_, i) => `${i}`.padEnd(100, "x"));
  expect(moduleToolParameterSchema.safeParse({ type: "string", enum: enumValues }).success).toBe(false);
});

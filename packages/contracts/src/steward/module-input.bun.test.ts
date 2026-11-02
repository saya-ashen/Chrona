import { expect, test } from "bun:test";
import { moduleToolParameterSchema } from "./module-input";

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

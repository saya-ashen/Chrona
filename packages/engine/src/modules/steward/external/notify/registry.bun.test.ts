import { expect, test } from "bun:test";
import { callbackReady, type Callback } from "./registry";

const output = { type: "object", required: ["outcome", "receiptRef"], properties: { outcome: { const: "accepted" }, receiptRef: { type: ["string", "null"] } } };
const input = { type: "object", properties: { key: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["key", "title", "body"] };
function ready(inputSchema: Callback["inputSchema"], outputSchema: unknown) {
  return callbackReady({ modules: [{ id: "id", name: "adapter", status: "active", activeHash: "code" }], tools: [{ target: "adapter.deliver", moduleId: "id", hash: "code", contractHash: "contract", inputSchema, outputSchema }] }, "id", "adapter", "deliver", "contract");
}
test("delivery schema guards retain missing property rejection", () => {
  expect(ready(input, output)).toBe(true);
  for (const properties of [undefined, {}, { outcome: { const: "accepted" } }, { receiptRef: { type: "string" } }]) {
    expect(ready(input, { ...output, properties })).toBe(false);
  }
  expect(ready({ ...input, properties: { key: { type: "string" }, title: { type: "string" } } }, output)).toBe(false);
  expect(ready(input, { ...output, properties: { outcome: { const: "rejected" }, error: { type: "string" } }, required: ["outcome", "retryable", "error"] })).toBe(false);
});

import { strict as assert } from "node:assert";
import { modelValue } from "./src/system/model-settings";
export function checkModelValues() {
  const numbers = { maxCallsPerEvent: "3", maxOutputTokens: "4000", dailyCalls: "30", timeoutSeconds: "123" };
  assert.deepEqual(modelValue([
    { tier: " strong ", model: " provider/model ", thinking: "high" },
    { tier: "fast", model: "provider/fast", thinking: "" },
    { tier: "", model: "ignored", thinking: "off" }, { tier: "ignored", model: " ", thinking: "" },
  ], [{ module: " example ", calls: "0" }, { module: "other", calls: "12" }, { module: "", calls: "4" }, { module: "ignored", calls: "" }], numbers), {
    models: { strong: { model: "provider/model", thinking: "high" }, fast: { model: "provider/fast" } }, maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, timeoutMs: 123000, moduleDailyCalls: { example: 0, other: 12 },
  });
  assert.deepEqual(modelValue([], [], numbers), { models: {}, maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, timeoutMs: 123000 });
}

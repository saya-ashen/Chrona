import { strict as assert } from "node:assert";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StateProvider } from "@json-render/react";
import { SystemContext } from "./src/system/action";
import { kernelCapsValue, ModuleModelSettings, NotificationSettings } from "./src/system/settings-forms";
export function checkModelValues() {
  const numbers = { maxCallsPerEvent: "3", maxOutputTokens: "4000", dailyCalls: "30", eventTimeoutMs: "123000", preferredTimeoutMs: "2000" };
  assert.deepEqual(kernelCapsValue([{ module: " example ", calls: "0" }, { module: "other", calls: "12" }, { module: "", calls: "4" }, { module: "ignored", calls: "" }], numbers), {
    maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, eventTimeoutMs: 123000, moduleDailyCalls: { example: 0, other: 12 },
  });
  // An explicit empty map lets an owner remove the last per-module override.
  assert.deepEqual(kernelCapsValue([], numbers), { maxCallsPerEvent: 3, maxOutputTokens: 4000, dailyCalls: 30, eventTimeoutMs: 123000, moduleDailyCalls: {} });
  const render = (element: ReactElement) => renderToStaticMarkup(createElement(SystemContext.Provider, { value: { call: async () => { throw new Error("Rendering must not call tools"); }, refresh: () => {} } }, createElement(StateProvider, { initialState: {}, children: element })));
  const settings = { timezone: "UTC", moduleModel: kernelCapsValue([], numbers), memory: { provider: "memory-local", available: false, autoRecall: true, autoRetain: false } };
  const caps = render(createElement(ModuleModelSettings, { props: { settings, section: "caps" } }));
  for (const name of ["maxCallsPerEvent", "maxOutputTokens", "dailyCalls", "eventTimeoutMs"]) assert.ok(caps.includes(`name="${name}"`), name);
  for (const name of ["model", "tier", "thinking", "preferredTimeoutMs", "timeoutSeconds"]) assert.ok(!caps.includes(`name="${name}"`), name);
  const timezone = render(createElement(NotificationSettings, { props: { settings, section: "budget" } }));
  assert.ok(timezone.includes('name="timezone"'));
  for (const name of ["provider", "autoRecall", "autoRetain", "quietStart", "dailyCap", "model", "tier"]) assert.ok(!timezone.includes(`name="${name}"`), name);
}

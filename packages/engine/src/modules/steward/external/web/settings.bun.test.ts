import { expect, test } from "bun:test";
import { settingsView, updateSettings, webSettings, webPreferences, WEB_SETTINGS_PAGE } from "./settings";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPreferences } from "./settings-store";
import { pageErrors } from "./pages";

type Args = Record<string, unknown>;
const kernel = { timezone: "UTC", runTimeoutMinutes: null, moduleModel: null, wake: { minIntervalMs: 60_000, dailyLimit: 1000, moduleDailyLimit: 100 }, modelUsage: [] };
function fixture() {
  const calls: [string, Args][] = [];
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push([target, args]);
    if (target === "settings.get") return kernel;
    if (target === "activity.usage") return { items: [], nextCursor: null };
    if (target === "settings.update") return {};
    if (target === "modules.describe") return { items: ["conversation-context", "conversation-retain", "preferences", "forget"].map(name => {
      const field = name === "preferences" ? undefined : name === "forget" ? "id" : "snapshot";
      return { target: `memory-local.${name}`, moduleId: "current-id", hash: "current-hash", inputSchema: { type: "object", properties: field ? { [field]: { type: "string" } } : {}, required: field ? [field] : [] } };
    }), nextCursor: null };
    if (target === "memory-local.preferences") return [{ id: "p", text: "中文" }];
    if (target === "memory-local.forget") return { forgotten: true };
    throw new Error(`Unexpected ${target}`);
  };
  return { call, calls };
}
test("global settings reads kernel governance without application discovery or projections", async () => {
  const f = fixture();
  expect(await settingsView(f.call)).toEqual({ settings: kernel });
  expect(f.calls).toEqual([["settings.get", {}], ["activity.usage", { limit: 100 }]]);
});
test("global saves only supplied kernel settings and empty input is read-only", async () => {
  const f = fixture(), caps = { maxCallsPerEvent: 2, maxOutputTokens: 1000, dailyCalls: 20, eventTimeoutMs: 5000 };
  expect(await updateSettings(f.call, { timezone: "Asia/Shanghai", moduleModel: caps })).toEqual({ settings: kernel });
  expect(f.calls).toEqual([["settings.update", { timezone: "Asia/Shanghai", moduleModel: caps }], ["settings.get", {}], ["activity.usage", { limit: 100 }]]);
  f.calls.length = 0;
  await updateSettings(f.call, {});
  expect(f.calls).toEqual([["settings.get", {}], ["activity.usage", { limit: 100 }]]);
});
test.each([null, 1, 45, 525600])("global settings forwards explicit task timeout %j without changing other settings", async runTimeoutMinutes => {
  const f = fixture();
  const call = async (target: string, args?: Args) => target === "settings.get" ? { ...kernel, runTimeoutMinutes } : f.call(target, args);
  expect(await updateSettings(call, { runTimeoutMinutes })).toEqual({ settings: { ...kernel, runTimeoutMinutes } });
  expect(f.calls).toEqual([["settings.update", { runTimeoutMinutes }], ["activity.usage", { limit: 100 }]]);
});
test.each([0, -1, 1.5, 525601, NaN, Infinity, "45", "", false, {}, [], undefined])("global settings rejects invalid task timeout %j before a write", async runTimeoutMinutes => {
  const f = fixture();
  await expect(updateSettings(f.call, { timezone: "UTC", runTimeoutMinutes })).rejects.toMatchObject({ code: "invalid" });
  expect(f.calls).toEqual([]);
});
test("global settings rejects app fields before any write, even mixed with valid kernel fields", async () => {
  for (const body of [null, [], { agent: {} }, { notifications: {} }, { memory: {} }, { timezone: "UTC", agent: { clear: true } }, { timezone: 1 }, { moduleModel: [] }, { moduleModel: { models: {} } }, { sessions: {} }]) {
    const f = fixture();
    await expect(updateSettings(f.call, body)).rejects.toMatchObject({ code: "invalid" });
    expect(f.calls).toEqual([]);
  }
});
test("kernel write and read failures propagate without touching applications", async () => {
  for (const failed of ["settings.update", "settings.get"]) {
    const f = fixture();
    await expect(updateSettings(async (target, args) => {
      if (target === failed) throw new Error("kernel failure");
      return f.call(target, args);
    }, { moduleModel: null })).rejects.toThrow("kernel failure");
    expect(f.calls.every(([target]) => target.startsWith("settings."))).toBe(true);
  }
});
test("Web form persists only its own preferences, supports restart and disabling memory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-settings-"));
  try {
    const f = fixture(), own = createPreferences(dir);
    const call = (target: string, args: Args = {}) => target === "web.settings" ? own.tool(args) : f.call(target, args);
    const patch = { provider: "memory-local", autoRecall: false, autoRetain: true };
    expect(await webSettings(call, own, { provider: patch.provider, "auto-recall": patch.autoRecall, "auto-retain": patch.autoRetain })).toEqual(patch);
    expect(await createPreferences(dir).read()).toEqual(patch);
    expect(await webPreferences(call, {})).toEqual({ items: [{ id: "p", text: "中文" }] });
    await webPreferences(call, { forget: "p" });
    expect(f.calls).toContainEqual(["memory-local.forget", { id: "p" }]);
    expect(await webSettings(call, own, { provider: "", "auto-recall": false, "auto-retain": false })).toEqual({ provider: "", autoRecall: false, autoRetain: false });
    expect(await createPreferences(dir).read()).toEqual({ provider: null, autoRecall: false, autoRetain: false });
    expect(f.calls.some(([target]) => target.startsWith("settings.") || target.startsWith("agent.") || target.startsWith("notify."))).toBe(false);
    for (const args of [{ provider: "bad provider", autoRecall: true, autoRetain: true }, { autoRecall: true }, { forget: "p", provider: "" }, { unknown: true }]) {
      await expect(webSettings(call, own, args)).rejects.toMatchObject({ code: "invalid" });
    }
    await writeFile(join(dir, "memory-preferences.json"), "broken");
    await expect(webSettings(call, own, {})).rejects.toMatchObject({ code: "invalid" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("provider read failure cannot disguise a successful local save", async () => {
  const dir = await mkdtemp(join(tmpdir(), "web-settings-failure-"));
  try {
    const own = createPreferences(dir), patch = { provider: "memory-local", autoRecall: true, autoRetain: false };
    const fail = async () => { throw new Error("discovery failed"); };
    expect(await webSettings(fail, own, { provider: patch.provider, "auto-recall": patch.autoRecall, "auto-retain": patch.autoRetain })).toEqual(patch);
    expect(await own.read()).toEqual(patch);
    await expect(webPreferences(fail, {})).rejects.toThrow("discovery failed");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("Web own settings page passes the actual declarative page validator", async () => {
  const manifest = await Bun.file(join(import.meta.dir, "module.json")).json() as { tools: { name: string; parameters: Args }[] };
  expect(pageErrors(WEB_SETTINGS_PAGE, new Map(manifest.tools.map(tool => [tool.name, tool.parameters])), "web")).toEqual([]);
});

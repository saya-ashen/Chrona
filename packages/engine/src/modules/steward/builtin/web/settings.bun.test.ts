import { expect, test } from "bun:test";
import { settingsView, updateSettings } from "./settings";

type Args = Record<string, unknown>;
function fixture() {
  const calls: [string, Args][] = [];
  const call = async (target: string, args: Args = {}): Promise<unknown> => {
    calls.push([target, args]);
    switch (target) {
      case "settings.get": return { timezone: "UTC", moduleModel: null, modelUsage: [] };
      case "modules.build-settings": return { builds: { dailyLimit: 3 }, buildUsage: { used: 1 } };
      case "notify.settings": return { settings: { dailyCap: 4 } };
      case "notify.status": return { chat: { channel: "qq", bound: true, sentToday: 2 } };
      case "modules.settings-get": return { values: { "memory-provider": "memory-local", "memory-auto-recall": false } };
      case "modules.contributions": return [{ module: "memory-local", hash: "hash", value: { interface: 1, context: "context" } }];
      case "memory-local.preferences": return [{ id: "p", text: "中文" }];
      case "approvals.grants": case "schedules.list": case "secrets.list": return [];
      case "settings.update": case "modules.settings-set": return {};
      default: throw new Error(`Unexpected ${target}`);
    }
  };
  return { call, calls };
}
test("Web privately composes settings and preserves selected-memory preferences", async () => {
  const f = fixture();
  expect(await settingsView(f.call)).toMatchObject({ settings: { timezone: "UTC", builds: { dailyLimit: 3 }, notifications: { dailyCap: 4 }, memory: { provider: "memory-local", autoRecall: false }, chat: { bound: true } }, preferences: [{ text: "中文" }], grants: [] });
  expect(f.calls.some(([target]) => target.startsWith("history.") || target === "memory.status")).toBe(false);
});
test("each supplied setting goes only to its owner, with full notification JSON", async () => {
  const f = fixture();
  const notifications = { dailyCap: 4, quietHours: null, timezone: "UTC", digestAt: "09:00" };
  await updateSettings(f.call, { timezone: "Asia/Shanghai", moduleModel: null, builds: { dailyLimit: 5 }, notifications, memory: { provider: "memory-local", autoRecall: false, autoRetain: true } });
  expect(f.calls.slice(0, 4)).toEqual([
    ["settings.update", { settings: JSON.stringify({ timezone: "Asia/Shanghai", moduleModel: null }) }],
    ["modules.build-settings", { limits: { dailyLimit: 5 } }],
    ["notify.settings", { settings: JSON.stringify(notifications) }],
    ["modules.settings-set", { module: "web", values: JSON.stringify({ "memory-provider": "memory-local", "memory-auto-recall": false, "memory-auto-retain": true }) }],
  ]);
});
test("null memory provider disables the app selection, not kernel memory", async () => {
  const f = fixture();
  await updateSettings(f.call, { memory: { provider: null } });
  expect(f.calls[0]).toEqual(["modules.settings-set", { module: "web", values: JSON.stringify({ "memory-provider": "" }) }]);
});
test("notification owner validation errors are not reported as saved", async () => {
  const f = fixture();
  await expect(updateSettings(async (target, args) => target === "notify.settings" && args?.settings
    ? { error: "invalid", message: "Invalid notification settings" } : f.call(target, args), { notifications: {} })).rejects.toMatchObject({ code: "invalid", message: "Invalid notification settings" });
  expect(f.calls).toEqual([]);
});
test("malformed or retired fields reject before any owner write", async () => {
  for (const body of [null, [], { sessions: {} }, { timezone: 1 }, { moduleModel: [] }, { builds: null }, { notifications: [] }, { memory: null }, { memory: { unknown: true } }, { memory: { provider: false } }, { memory: { autoRecall: "true" } }]) {
    const f = fixture();
    await expect(updateSettings(f.call, body)).rejects.toMatchObject({ code: "invalid" });
    expect(f.calls).toEqual([]);
  }
});

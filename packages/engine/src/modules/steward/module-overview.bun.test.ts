import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, moduleRuntimeParams } from "@chrona/contracts/steward";
import { settingsView, moduleSettingsOutputSchema, setModuleSettings } from "./module-overview";
import { registerSystemModules } from "./system-modules";
import { createSettings } from "./settings";
import { callSync } from "./module-calls";
import { moduleInterfaces, moduleInterfacesOutputSchema } from "./system-apps";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
const dbs: ReturnType<typeof testDb>[] = [];
afterEach(async () => { for (const db of dbs.splice(0)) await db.$disconnect(); });
const base = { name: "okx-trader", entry: "index.ts", tests: ["test.ts"], effects: [], triggers: [], keepAlive: true };
const settings = {
  "max-loss": { type: "number", label: "最大亏损", default: 100, min: 10, max: 500 },
  mode: { type: "string", label: "模式", default: "demo", options: ["demo", "paper"] },
};
async function fixture() {
  registerSystemModules();
  const db = testDb(); dbs.push(db);
  const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-settings-read-")), now: () => new Date("2026-10-27T15:00:00Z"), publicUrl: null };
  const w = (await db.workspace.create({ data: { name: "settings-read" } })).id;
  const module = await db.module.create({ data: { workspaceId: w, name: "okx-trader", activeHash: "h1", status: "active" } });
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: "h1", manifest: moduleManifestSchema.parse({ ...base, settings, params: { pair: { type: "string", value: "BTC-USDT" } } }), source: "provider", intent: {}, report: {}, status: "active" } });
  return { db, ports, w, module };
}
test("a manifest declares settings within bounds; a name shared with a param is refused", () => {
  expect(moduleManifestSchema.safeParse({ ...base, settings }).success).toBe(true);
  expect(moduleManifestSchema.safeParse({ ...base, settings: { x: { type: "number", label: "x", default: 1000, max: 500 } } }).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...base, settings: { x: { type: "boolean", label: "x", default: "yes" } } }).success).toBe(false);
  expect(moduleManifestSchema.safeParse({ ...base, settings: { pair: { type: "string", label: "p", default: "a" } }, params: { pair: { type: "string", value: "b" } } }).success).toBe(false);
  const manifest = moduleManifestSchema.parse({ ...base, settings, params: { pair: { type: "string", value: "BTC-USDT" } } });
  expect(moduleRuntimeParams(manifest, { moduleSettings: { "okx-trader": { "max-loss": 50, mode: "live" } } })).toEqual({ pair: "BTC-USDT", "max-loss": 50, mode: "demo" });
});
test("settings-set validates all entries before writing and settings-get returns effective values by name or id", async () => {
  const f = await fixture();
  await expect(setModuleSettings(f.ports, f.w, "okx-trader", { "max-loss": 50, unknown: 1 })).rejects.toThrow("Unknown setting unknown");
  await expect(setModuleSettings(f.ports, f.w, "okx-trader", { "max-loss": 9999 })).rejects.toThrow("最大亏损");
  expect(await settingsView(f.ports, f.w, f.module.id)).toMatchObject({ values: { "max-loss": 100, mode: "demo" } });
  moduleSettingsOutputSchema.parse(await setModuleSettings(f.ports, f.w, "okx-trader", { "max-loss": 50 }));
  expect(await settingsView(f.ports, f.w, "okx-trader")).toMatchObject({ values: { "max-loss": 50, mode: "demo" } });
  const audit = await f.db.audit.findFirstOrThrow({ where: { workspaceId: f.w, kind: "module_settings_updated" } });
  expect(audit.details).toEqual({ keys: ["max-loss"] });
  await expect(settingsView(f.ports, f.w, "missing")).rejects.toMatchObject({ code: "not_found" });
});
test("settings-get uses defaults for obsolete values and no declarations for local/unconfigured apps", async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.w }, data: { settings: { moduleSettings: { "okx-trader": { "max-loss": 5, mode: "paper" } } } } });
  expect(await settingsView(f.ports, f.w, "okx-trader")).toMatchObject({ values: { "max-loss": 100, mode: "paper" } });
  await f.db.module.create({ data: { workspaceId: f.w, name: "inactive" } });
  for (const name of ["workspace-local", "inactive", "activity"]) expect(await settingsView(f.ports, f.w, name)).toEqual({ declarations: {}, values: {} });
});
test("kernel settings expose only governance; retired memory has no system settings", async () => {
  const f = await fixture();
  const owner = { workspaceId: f.w, caller: { kind: "owner" as const, via: null }, chain: [], path: [] };
  const updated = await createSettings({ ...f.ports, workspaceId: f.w }).update({ timezone: "Asia/Shanghai" });
  expect(Object.keys(updated).sort()).toEqual(["modelUsage", "moduleModel", "timezone"]);
  expect(updated).toMatchObject({ timezone: "Asia/Shanghai" });
  expect((await callSync(f.ports, owner, "modules.build-settings", {})).output).toHaveProperty("builds");
  await expect(setModuleSettings(f.ports, f.w, "activity", {})).rejects.toThrow("has no settings");
  await expect(setModuleSettings(f.ports, f.w, "memory", { provider: "memory-local" })).rejects.toMatchObject({ code: "not_found" });
  await expect(settingsView(f.ports, f.w, "memory")).rejects.toMatchObject({ code: "not_found" });
  for (const target of ["memory.get", "content.read", "history.file"]) await expect(callSync(f.ports, owner, target, {})).rejects.toMatchObject({ code: "not_found" });
});
test("interfaces are read-only declarations and local metadata grants no execution authority", async () => {
  const f = await fixture();
  const directory = moduleInterfacesOutputSchema.parse(await moduleInterfaces(f.ports, f.w)) as { name: string; runtime?: { status: string } }[];
  expect(directory.filter(item => item.runtime).map(item => item.name).sort()).toEqual(["runtime-callback", "workspace-local"]);
  for (const name of ["runtime-callback", "workspace-local"]) {
    const view = await moduleInterfaces(f.ports, f.w, name);
    expect(view).toMatchObject({ capabilities: { build: false, configure: false, disable: false, remove: false }, runtime: { status: "registered" } });
    if (Array.isArray(view)) throw new Error("Expected one interface");
    expect(view).not.toHaveProperty("work"); expect(view).not.toHaveProperty("activity"); expect(view).not.toHaveProperty("settings");
    expect(view.tools.every(tool => !tool.visibility.includes("owner"))).toBe(true);
    for (const tool of view.tools) await expect(callSync(f.ports, { workspaceId: f.w, caller: { kind: "owner", via: null }, chain: [], path: [] }, `${name}.${tool.name}`, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(setModuleSettings(f.ports, f.w, name, {})).rejects.toThrow();
  }
  const owner = { workspaceId: f.w, caller: { kind: "owner" as const, via: null }, chain: [], path: [] };
  expect((await callSync(f.ports, owner, "modules.settings-get", { module: "workspace-local" })).output).toEqual({ declarations: {}, values: {} });
  const exposed = moduleInterfacesOutputSchema.parse((await callSync(f.ports, owner, "modules.interfaces", {})).output) as { name: string }[];
  expect(exposed.some(item => item.name === "agent")).toBe(false);
  for (const retired of ["modules.system", "modules.overview", "content.read", "history.file"]) await expect(callSync(f.ports, owner, retired, {})).rejects.toMatchObject({ code: "not_found" });
  await expect(moduleInterfaces(f.ports, f.w, "reflection")).rejects.toMatchObject({ code: "not_found" });
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.moduleInvocation.count({ where: { target: { in: ["agent", "content-local", "runtime-callback", "workspace-local"] } } })).toBe(0);
});
test("selected app metadata preserves declared interfaces without making private tools callable", async () => {
  const f = await fixture();
  const output = { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"], additionalProperties: false };
  const manifest = moduleManifestSchema.parse({ ...base, settings, tools: [{ name: "private", description: "Private metadata", visibility: ["modules"], idempotent: true, parameters: { type: "object", properties: {} }, output, examples: [{ args: {}, result: { saved: true } }] }] });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.module.id, hash: "h1" } }, data: { manifest } });
  const view = moduleInterfacesOutputSchema.parse(await moduleInterfaces(f.ports, f.w, f.module.id));
  expect(view).toMatchObject({ name: "okx-trader", origin: "external", capabilities: { configure: true }, tools: [{ name: "private", outputSchema: output, examples: [{ args: {}, result: { saved: true } }], visibility: ["modules"] }] });
  await expect(callSync(f.ports, { workspaceId: f.w, caller: { kind: "owner", via: null }, chain: [], path: [] }, "okx-trader.private", {})).rejects.toMatchObject({ code: "forbidden" });
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await expect(moduleInterfaces(f.ports, other.id, f.module.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(settingsView(f.ports, other.id, f.module.id)).rejects.toMatchObject({ code: "not_found" });
});
test("metadata/settings reads never execute health checks or expose Provider diagnostics", async () => {
  const f = await fixture(); let starts = 0, probes = 0;
  f.ports.provider = { name: "pi", health: async () => { probes++; throw new Error("private diagnostics"); }, start() { starts++; throw new Error("must not execute"); } };
  const view = moduleInterfacesOutputSchema.parse(await moduleInterfaces(f.ports, f.w, "workspace-local"));
  expect(view).toMatchObject({ runtime: { status: "registered", backend: null } });
  expect(JSON.stringify(view)).not.toContain("private diagnostics");
  await settingsView(f.ports, f.w, "workspace-local");
  expect(starts).toBe(0); expect(probes).toBe(0);
});

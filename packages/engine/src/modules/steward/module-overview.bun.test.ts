import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, moduleRuntimeParams } from "@chrona/contracts/steward";
import { moduleOverview, moduleOverviewOutputSchema, moduleSettingsOutputSchema, setModuleSettings } from "./module-overview";
import { registerSystemModules } from "./system-modules";
import { listActivity } from "./activity";
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
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-overview-"));
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-10-27T15:00:00Z"), publicUrl: null };
  const w = (await db.workspace.create({ data: { name: "overview" } })).id;
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
  // Stored values that no longer fit fall back to the default.
  expect(moduleRuntimeParams(manifest, { moduleSettings: { "okx-trader": { "max-loss": 50, mode: "live" } } })).toEqual({ pair: "BTC-USDT", "max-loss": 50, mode: "demo" });
});

test("settings are changed only within what the active version declares, audited, and reach the overview", async () => {
  const f = await fixture();
  await expect(setModuleSettings(f.ports, f.w, "okx-trader", { unknown: 1 })).rejects.toThrow("Unknown setting unknown");
  await expect(setModuleSettings(f.ports, f.w, "okx-trader", { "max-loss": 9999 })).rejects.toThrow("最大亏损");
  expect(await setModuleSettings(f.ports, f.w, "okx-trader", { "max-loss": 50 })).toMatchObject({ values: { "max-loss": 50, mode: "demo" } });
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.w } })).settings).toMatchObject({ moduleSettings: { "okx-trader": { "max-loss": 50 } } });
  expect((await listActivity(f.ports, f.w, { module: "okx-trader" })).items.map(item => item.text)).toContain("你修改了 okx-trader 的设置：max-loss");
  expect(await moduleOverview(f.ports, f.w, "okx-trader")).toMatchObject({ kind: "app", settings: { values: { "max-loss": 50 } }, permissions: { module: "okx-trader" } });
});

test("a system module's settings are its own: memory's provider goes through the owner's settings", async () => {
  const f = await fixture();
  expect(await setModuleSettings(f.ports, f.w, "memory", { provider: "memory-local", autoRetain: false })).toMatchObject({ values: { provider: "memory-local", autoRecall: true, autoRetain: false } });
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.w } })).settings).toMatchObject({ memory: { provider: "memory-local", autoRetain: false } });
  expect(await setModuleSettings(f.ports, f.w, "memory", { provider: "" })).toMatchObject({ values: { provider: "" } });
  await expect(setModuleSettings(f.ports, f.w, "activity", {})).rejects.toThrow("has no settings");
  expect(await moduleOverview(f.ports, f.w, "memory")).toMatchObject({ kind: "system", name: "memory", settings: { declarations: { autoRecall: { type: "boolean" } } } });
});

test("retired reflection is not a system app, while its historical activity keeps process links", async () => {
  const f = await fixture();
  await expect(moduleOverview(f.ports, f.w, "reflection")).rejects.toThrow();
  for (const item of [
    { kind: "reflection_started", subjectId: "old-reflect", details: { signals: [{ kind: "module_activate", module: "example" }] } },
    { kind: "reflection_suggested", subjectId: "old-build", details: { title: "历史修复", why: "历史原因", modules: ["example"] } },
  ]) await f.db.audit.create({ data: { workspaceId: f.w, actorKey: "chrona", ...item } });
  const { items } = await listActivity(f.ports, f.w, { module: "reflection" });
  expect(items).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: "Chrona 反思了一次（example 上线）", session: { id: "old-reflect", source: "reflect" } }),
    expect.objectContaining({ text: "Chrona 开始构建「历史修复」（example）：历史原因", session: { id: "old-build", source: "build" } }),
  ]));
});

test("real overview and settings-set results fit their declared output schemas", async () => {
  const f = await fixture();
  moduleSettingsOutputSchema.parse(await setModuleSettings(f.ports, f.w, "okx-trader", { "max-loss": 50 }));
  moduleOverviewOutputSchema.parse(await moduleOverview(f.ports, f.w, "okx-trader"));
  for (const name of ["memory", "activity"]) moduleOverviewOutputSchema.parse(await moduleOverview(f.ports, f.w, name));
});


test("builtin overview retains origin and protected deletion while exposing checked Git version and update actions", async () => {
  const f = await fixture(), hash = "a".repeat(40), tree = "b".repeat(40);
  await f.db.module.update({ where: { id: f.module.id }, data: { name: "files", builtin: true, activeHash: hash } });
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash, manifest: moduleManifestSchema.parse({ ...base, name: "files" }), source: "user", status: "approved", intent: {}, report: { tests: [], git: { commit: hash, tree } } } });
  const overview = await moduleOverview(f.ports, f.w, "files");
  expect(overview).toMatchObject({ kind: "app", app: { origin: "builtin", activeHash: hash, capabilities: { build: true, propose: true, group: true, activate: true, update: true, rollback: true, remove: false, install: false }, versions: expect.arrayContaining([expect.objectContaining({ hash, git: { commit: hash, tree } })]) } });
  moduleOverviewOutputSchema.parse(overview);
});

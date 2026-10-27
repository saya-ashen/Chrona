import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, moduleRuntimeParams } from "@chrona/contracts/steward";
import { moduleOverview, setModuleSettings } from "./module-overview";
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

test("a system module's settings are its own: reflection's switch and memory's provider go through the owner's settings", async () => {
  const f = await fixture();
  expect(await setModuleSettings(f.ports, f.w, "reflection", { enabled: false })).toEqual(expect.objectContaining({ values: { enabled: false } }));
  expect(await setModuleSettings(f.ports, f.w, "memory", { provider: "memory-local", autoRetain: false })).toMatchObject({ values: { provider: "memory-local", autoRecall: true, autoRetain: false } });
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.w } })).settings).toMatchObject({ reflection: { enabled: false }, memory: { provider: "memory-local", autoRetain: false } });
  expect(await setModuleSettings(f.ports, f.w, "memory", { provider: "" })).toMatchObject({ values: { provider: "" } });
  await expect(setModuleSettings(f.ports, f.w, "activity", {})).rejects.toThrow("has no settings");
  expect(await moduleOverview(f.ports, f.w, "reflection")).toMatchObject({ kind: "system", name: "reflection", settings: { declarations: { enabled: { type: "boolean" } } } });
});

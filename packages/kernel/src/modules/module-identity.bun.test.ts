import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { KERNEL_MODULE_NAMES, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "../__testing__/test-db";
import { moduleContext } from "./module-context";
import { activateIn } from "./module-generation";
import { rollback } from "./module-activation";
import { buildPending } from "./module-build";
import { resolveBuiltinRelease } from "./module-release";
import { requestStatus} from "./module-status";
import { assertExternalName, assertModuleOperation, moduleIdentity } from "./module-identity";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "../ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb({ injectedAgent: false }), dataDir = await mkdtemp("/tmp/chrona-identity-");
  closes.push(async () => { await moduleSupervisor(ports).stop(); await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "identity" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z") };
  const context = moduleContext(ports, workspace.id);
  async function app(name: string, builtin = false, source = "user") {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] });
    const module = await db.module.create({ data: { workspaceId: workspace.id, name, builtin, activeHash: "old", dataSchema: 1 } });
    for (const hash of ["old", "next"]) await db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest, source, status: "approved", intent: { changes: [hash] }, report: {} } });
    return { ...module, manifest };
  }
  return { db, workspace, ports, context, app, dataDir };
}

test("an ordinary external entry accepts checked updates, rollback and deletion", async () => {
  const name = "ordinary-entry";
  const f = await fixture(), app = await f.app(name, false);
  expect(moduleIdentity(app)).toMatchObject({ origin: "external", capabilities: { build: true, propose: true, group: true, activate: true, update: true, rollback: true, remove: true, install: false } });
  for (const operation of ["build", "propose", "group", "activate", "update", "rollback"] as const) {
    expect(() => assertModuleOperation(app, operation)).not.toThrow();
    expect(await assertExternalName(f.db, f.workspace.id, name, operation)).toMatchObject({ id: app.id });
  }
  for (const operation of ["remove", "install"] as const) expect(() => assertModuleOperation(app, operation)).not.toThrow();
  await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: app.id, hash: "next", reason: "activate" }));
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ builtin: false, activeHash: "next" });
  await rollback(f.context, app.id, "old");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ builtin: false, activeHash: "old" });
});

test("a historical source annotation cannot grant builtin identity", async () => {
  const name = "legacy-source-entry";
  const f = await fixture(), app = await f.app(name, false, "builtin");
  expect(moduleIdentity(app)).toMatchObject({ origin: "external", capabilities: { build: true, propose: true, group: true, update: true, rollback: true, remove: true } });
  for (const operation of ["build", "propose", "group", "activate", "update", "rollback"] as const) {
    expect(() => assertModuleOperation(app, operation)).not.toThrow();
  }
  expect(() => assertModuleOperation(app, "remove")).not.toThrow();
  expect(await assertExternalName(f.db, f.workspace.id, name, "propose")).toMatchObject({ id: app.id });
  expect(moduleIdentity({ name, builtin: true }, { removable: false }).capabilities.remove).toBe(false);
  expect(moduleIdentity({ name: "other-entry", builtin: false }, { removable: false }).capabilities.remove).toBe(false);
});

test.each([...KERNEL_MODULE_NAMES])("persisted builtin flag cannot grant dynamic authority to %s", async name => {
  const f = await fixture(), app = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, builtin: true } });
  expect(() => assertModuleOperation(app, "activate")).toThrow();
  await expect(assertExternalName(f.db, f.workspace.id, name, "propose")).rejects.toMatchObject({ code: "forbidden" });
});

test.each(["building", "pending_review"])("%s candidate becoming builtin is rejected before dependency install, author tests or activation", async status => {
  const f = await fixture(), app = await f.app("example");
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } }, data: { status } });
  await f.db.module.update({ where: { id: app.id }, data: { builtin: true } });
  let executed = 0;
  f.ports.packages = { install: async () => { executed++; throw new Error("must not install"); } } as NonNullable<StewardPorts["packages"]>;
  await buildPending(f.context);
  expect(executed).toBe(0);
  expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } } })).status).toBe("rejected");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).activeHash).toBe("old");
  expect(await f.db.session.count()).toBe(0);
});

test("version source does not grant builtin identity and external activation preserves pause", async () => {
  const f = await fixture(), app = await f.app("example", false, "builtin");
  expect(moduleManifestSchema.safeParse({ ...app.manifest, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] }).success).toBe(false);
  const dynamic = await f.db.timer.create({ data: { workspaceId: f.workspace.id, moduleId: app.id, rule: { kind: "at", at: "2026-12-01T12:00:00Z" }, payload: { task: "later" }, timerId: "later", nextAt: new Date("2026-12-01T12:00:00Z") } });
  const independentlyPaused = await f.db.timer.create({ data: { workspaceId: f.workspace.id, moduleId: app.id, rule: { kind: "at", at: "2026-12-01T12:00:00Z" }, payload: { task: "manual" }, timerId: "manual", status: "paused" } });
  await requestStatus(f.context, app.id, "paused", "maintenance");
  await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: app.id, hash: "next", reason: "activate" }));
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } }))).toMatchObject({ activeHash: "next", builtin: false, status: "paused" });
  expect(await f.db.timer.count({ where: { moduleId: app.id } })).toBe(2);
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: dynamic.id } })).toMatchObject({ status: "active" });
  await requestStatus(f.context, app.id, "active", "explicit enable");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "active", activeHash: "next", builtin: false });
  expect(await f.db.timer.count({ where: { moduleId: app.id } })).toBe(2);
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: dynamic.id } })).toMatchObject({ status: "active", nextAt: dynamic.nextAt });
  expect(await f.db.timer.findUniqueOrThrow({ where: { id: independentlyPaused.id } })).toMatchObject({ status: "paused", nextAt: null });
});

test("Agent has no builtin release even when old resources are supplied", async () => {
  const f = await fixture();
  f.ports.moduleBuiltinResources = join(f.dataDir, "release");
  await expect(resolveBuiltinRelease(f.ports, "agent")).rejects.toMatchObject({ reason: "release_not_found" });
  expect(await f.db.module.count()).toBe(0);
});

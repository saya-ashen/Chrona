import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { propose } from "./module-proposal";
import { queueBuild } from "./module-build-session";
import { activateIn, activateBuiltinReleaseIn } from "./module-generation";
import { rollback } from "./module-activation";
import { buildPending } from "./module-build";
import { requestGroup } from "./module-group";
import { resolveBuiltinRelease } from "./module-release";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { currentModuleEvolution, updateModuleEvolution } from "./module-evolution";
import { requestStatus, setStatusIn } from "./module-status";
import { rollbackFailedStart } from "./module-generation";
import { assertExternalName, assertModuleOperation, moduleIdentity } from "./module-identity";
import { isModulePaused, PAUSED_MODULE_NAMES } from "./module-availability";
import { requestRemove, removeApproved } from "./module-remove";
import { moduleSupervisor } from "./module-supervisor";
import type { StewardPorts } from "./ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-identity-");
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
const request = (name: string) => ({ name, goal: "Change application", intent: { changes: ["fix"], preserves: [] }, examples: [], files: [] });

test.each([...BUILTIN_MODULE_NAMES, ...KERNEL_MODULE_NAMES, "rescue"])("empty-workspace reserved name %s rejects admission and proposal without records", async name => {
  const f = await fixture();
  await expect(queueBuild(f.ports, f.workspace.id, { key: "build", actorKey: "user", originSessionId: null, request: request(name) })).rejects.toMatchObject({ code: "forbidden" });
  await mkdir(join(f.dataDir, "candidate"));
  const manifest = { name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] };
  await writeFile(join(f.dataDir, "candidate/module.json"), JSON.stringify(manifest));
  await writeFile(join(f.dataDir, "candidate/index.ts"), "export {};");
  const proposal = propose(f.context, { root: f.dataDir, dir: "candidate", intent: request(name).intent }, "user");
  if (moduleManifestSchema.safeParse(manifest).success) await expect(proposal).rejects.toMatchObject({ code: "forbidden" });
  else expect(await proposal).toMatchObject({ moduleId: null, status: "rejected", report: { errors: [expect.stringContaining("reserved")] } });
  expect(await f.db.module.count()).toBe(0);
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect(await f.db.session.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
});

test.each(["web", "notify"])("ordinary preinstalled %s accepts checked updates, rollback and deletion", async name => {
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

test.each(["mcp", "files", "events"])("optional official %s has external lifecycle rights without reviving builtin identity", async name => {
  const f = await fixture(), app = await f.app(name, false, "builtin");
  const available = !isModulePaused(name);
  expect(moduleIdentity(app)).toMatchObject({ origin: "external", capabilities: { build: available, propose: available, group: available, update: available, rollback: available, remove: true } });
  for (const operation of ["build", "propose", "group", "activate", "update", "rollback"] as const) {
    if (available) expect(() => assertModuleOperation(app, operation)).not.toThrow();
    else expect(() => assertModuleOperation(app, operation)).toThrow("unavailable: paused");
  }
  expect(() => assertModuleOperation(app, "remove")).not.toThrow();
  if (available) expect(await assertExternalName(f.db, f.workspace.id, name, "propose")).toMatchObject({ id: app.id });
  else await expect(assertExternalName(f.db, f.workspace.id, name, "propose")).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
  expect(moduleIdentity({ name, builtin: true }, { removable: false }).capabilities.remove).toBe(false);
  expect(moduleIdentity({ name: "other-entry", builtin: false }, { removable: false }).capabilities.remove).toBe(false);
});

test("builtin Agent cannot be replaced through dynamic application lifecycle", async () => {
  const f = await fixture(), app = await f.app("agent", true);
  expect(moduleIdentity(app)).toMatchObject({ origin: "builtin", capabilities: { build: false, update: false, remove: false } });
  for (const operation of ["build", "propose", "group", "activate", "update", "rollback", "remove", "install"] as const) expect(() => assertModuleOperation(app, operation)).toThrow();
});

test.each([...KERNEL_MODULE_NAMES, "rescue"])("persisted builtin flag cannot grant dynamic authority to %s", async name => {
  const f = await fixture(), app = await f.db.module.create({ data: { workspaceId: f.workspace.id, name, builtin: true } });
  expect(() => assertModuleOperation(app, "activate")).toThrow();
  await expect(assertExternalName(f.db, f.workspace.id, name, "propose")).rejects.toMatchObject({ code: "forbidden" });
});

test.each(["building", "pending_review"])("%s candidate becoming builtin is rejected before dependency install, author tests or activation", async status => {
  const f = await fixture(), app = await f.app("example");
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } }, data: { status } });
  await f.db.module.update({ where: { id: app.id }, data: { builtin: true } });
  let executed = 0;
  f.ports.packages = { backend: "system", install: async () => { executed++; throw new Error("must not install"); } } as NonNullable<StewardPorts["packages"]>;
  await buildPending(f.context);
  expect(executed).toBe(0);
  expect((await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } } })).status).toBe("rejected");
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).activeHash).toBe("old");
  expect(await f.db.session.count()).toBe(0);
});

test("version source does not grant builtin identity and external activation preserves pause", async () => {
  const f = await fixture(), app = await f.app("example", false, "builtin");
  expect(moduleManifestSchema.safeParse({ ...app.manifest, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] }).success).toBe(false);
  const dynamic = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: app.id, mode: "module", triggerId: "timer", rule: { kind: "at", at: "2026-12-01T12:00:00Z" }, payload: { task: "later" }, text: "later", createdBy: "example", nextAt: new Date("2026-12-01T12:00:00Z") } });
  const independentlyPaused = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: app.id, mode: "module", triggerId: "manual", rule: { kind: "at", at: "2026-12-01T12:00:00Z" }, payload: { task: "manual" }, text: "manual", createdBy: "example", status: "paused" } });
  await requestStatus(f.context, app.id, "paused", "maintenance");
  await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: app.id, hash: "next", reason: "activate" }));
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } }))).toMatchObject({ activeHash: "next", builtin: false, status: "paused" });
  expect(await f.db.schedule.count({ where: { moduleId: app.id, triggerId: "daily" } })).toBe(0);
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: dynamic.id } })).toMatchObject({ status: "cancelled", nextAt: null });
  await requestStatus(f.context, app.id, "active", "explicit enable");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "active", activeHash: "next", builtin: false });
  expect(await f.db.schedule.count({ where: { moduleId: app.id, triggerId: "daily" } })).toBe(0);
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: dynamic.id } })).toMatchObject({ status: "cancelled", nextAt: null });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: independentlyPaused.id } })).toMatchObject({ status: "cancelled", nextAt: null });
});

test("trusted Git seed is idempotent and rejects untrusted metadata or replacing active code", async () => {
  const f = await fixture();
  f.ports.moduleBuiltinResources = join(f.dataDir, "release");
  await mkdir(join(f.ports.moduleBuiltinResources, "agent"), { recursive: true });
  const app = await f.app("agent", true);
  await writeFile(join(f.ports.moduleBuiltinResources, "agent/module.json"), JSON.stringify(app.manifest));
  await writeFile(join(f.ports.moduleBuiltinResources, "agent/index.ts"), "export {};");
  const git = await seedTestModuleRelease(f.ports.moduleBuiltinResources!, "agent");
  const release = await resolveBuiltinRelease(f.ports, "agent");
  await f.db.moduleVersion.create({ data: { moduleId: app.id, hash: release.hash, manifest: release.manifest, source: "builtin", status: "approved", intent: {}, report: { git: { commit: git.commit, tree: git.tree } } } });
  await requestStatus(f.context, app.id, "paused", "maintenance");
  await f.db.module.update({ where: { id: app.id }, data: { activeHash: null } });
  await f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release));
  const evolution = await currentModuleEvolution(f.db, f.workspace.id, app.id, release.hash);
  await f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release));
  expect(await f.db.generation.count()).toBe(1);
  expect(await currentModuleEvolution(f.db, f.workspace.id, app.id, release.hash)).toEqual(evolution);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ activeHash: release.hash, status: "paused" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: release.hash } }, data: { source: "user" } });
  await expect(f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release))).rejects.toMatchObject({ code: "conflict" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: release.hash } }, data: { source: "builtin" } });
  await f.db.module.update({ where: { id: app.id }, data: { activeHash: "next" } });
  await expect(f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release))).rejects.toMatchObject({ code: "conflict" });
  await f.db.module.update({ where: { id: app.id }, data: { activeHash: null } });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: release.hash } }, data: { report: { git: { commit: "b".repeat(40), tree: git.tree } } } });
  await expect(f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release))).rejects.toMatchObject({ code: "conflict" });
  await f.db.module.update({ where: { id: app.id }, data: { builtin: false } });
  await expect(f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release))).rejects.toMatchObject({ code: "conflict" });
});

test("a real automatically activated group cannot partially roll back after start failure", async () => {
  const f = await fixture(), apps = [await f.app("first"), await f.app("second")];
  const session = await f.db.session.create({ data: { workspaceId: f.workspace.id, key: "build", source: "build" } });
  await f.db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "chrona", kind: "build_request", subjectId: session.id, details: { name: "first", modules: ["first", "second"] } } });
  for (const app of apps) {
    const version = await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } }, data: { source: "build", status: "pending_review" } });
    await f.db.audit.create({ data: { workspaceId: f.workspace.id, actorKey: "chrona", kind: "module_submission", subjectId: app.id, details: { hash: "next", sessionId: session.id } } });
    await f.db.audit.create({ data: { id: `module-review:${version.id}`, workspaceId: f.workspace.id, actorKey: "chrona", kind: "module_review", details: { prefix: "", suffix: "", codeDiff: "", detail: "", needsMigration: false } } });
  }
  expect(await requestGroup(f.ports, f.workspace.id, session.id, apps.map(app => ({ module: app.name, hash: "next" })))).toEqual({ status: "approved" });
  expect(await f.db.approval.count()).toBe(0);
  const app = apps[0]!, activation = await currentModuleEvolution(f.db, f.workspace.id, app.id, "next");
  await updateModuleEvolution(f.db, { workspaceId: f.workspace.id, moduleId: app.id, activationId: activation!.activationId, hash: "next", status: "failed", now: f.ports.now() });
  expect(await rollbackFailedStart(f.context, app.id, "next", activation!.activationId)).toMatchObject({ rolledBack: false, reason: expect.stringContaining("group") });
  expect((await f.db.module.findMany()).map(app => app.activeHash)).toEqual(["next", "next"]);
});

test.each(["building", "pending_review"])("stored %s candidates for a paused app reject without interrupting build recovery", async status => {
  const f = await fixture(), app = await f.app("mind");
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } }, data: { status } });
  let executed = 0;
  f.ports.packages = { backend: "system", install: async () => { executed++; throw new Error("Paused apps must not install dependencies"); } } as NonNullable<StewardPorts["packages"]>;
  await buildPending(f.context);
  expect(executed).toBe(0);
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } } })).toMatchObject({ status: "rejected" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ activeHash: "old" });
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
});

test.each([...PAUSED_MODULE_NAMES])("paused %s cannot enable through owner or provider status paths", async name => {
  const f = await fixture(), app = await f.app(name);
  for (const status of ["active", "paused"] as const) {
    await f.db.module.update({ where: { id: app.id }, data: { status } });
    const attempts = await Promise.allSettled([
      requestStatus(f.context, app.id, "active", "Attempt enable"),
      f.db.$transaction(tx => setStatusIn(f.context, tx, app.id, "active", { source: "owner", reason: "Attempt enable" })),
    ]);
    for (const attempt of attempts) {
      expect(attempt.status).toBe("rejected");
      if (attempt.status === "rejected") expect(attempt.reason).toMatchObject({ code: "unavailable", reason: "module_paused" });
    }
    expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status, activeHash: "old" });
  }
  expect(await f.db.audit.count({ where: { kind: "module_enabled" } })).toBe(0);
});

test.each([...PAUSED_MODULE_NAMES])("paused %s rejects new and installed dynamic work while retaining cleanup", async name => {
  const f = await fixture();
  await expect(queueBuild(f.ports, f.workspace.id, { key: "paused-new", actorKey: "user", originSessionId: null, request: request(name) })).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
  expect(await f.db.module.count()).toBe(0);
  const app = await f.app(name);
  const capabilities = moduleIdentity(app, { configurable: true }).capabilities;
  for (const operation of ["build", "propose", "group", "activate", "update", "rollback", "install", "enable", "configure"] as const) {
    expect(capabilities[operation]).toBe(false);
    expect(() => assertModuleOperation(app, operation)).toThrow("unavailable: paused");
    await expect(assertExternalName(f.db, f.workspace.id, name, operation)).rejects.toMatchObject({ code: "unavailable", reason: "module_paused" });
  }
  for (const operation of ["disable", "remove", "diagnose"] as const) {
    expect(capabilities[operation]).toBe(true);
    expect(() => assertModuleOperation(app, operation)).not.toThrow();
  }
  await expect(queueBuild(f.ports, f.workspace.id, { key: "paused-existing", actorKey: "user", originSessionId: null, request: request(name) })).rejects.toMatchObject({ code: "unavailable" });
  await expect(f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: app.id, hash: "next", reason: "activate" }))).rejects.toMatchObject({ code: "unavailable" });
  await expect(rollback(f.context, app.id, "next")).rejects.toMatchObject({ code: "unavailable" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ activeHash: "old" });
  expect(await f.db.session.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
  await requestStatus(f.context, app.id, "paused", "cleanup");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ status: "paused", activeHash: "old" });
  const removal = await requestRemove(f.context, app.id, "Owner approved cleanup");
  const approval = await f.db.approval.update({ where: { id: removal.approvalId }, data: { status: "approved" } });
  await removeApproved(f.context, { workspaceId: f.workspace.id, approvalId: approval.id, payload: approval.payload! });
  expect(await f.db.module.findUnique({ where: { id: app.id } })).toBeNull();
  expect(await f.db.moduleVersion.count({ where: { moduleId: app.id } })).toBe(0);
  expect(await f.db.audit.count({ where: { subjectId: app.id, kind: "module_removed" } })).toBe(1);
});

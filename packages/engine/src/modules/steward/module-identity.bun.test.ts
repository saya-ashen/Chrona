import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES, KERNEL_MODULE_NAMES, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { propose } from "./module-proposal";
import { queueBuild } from "./module-build-session";
import { activateIn, activateBuiltinReleaseIn, switchActiveIn } from "./module-generation";
import { rollback, activateApprovedIn } from "./module-activation";
import { buildPending } from "./module-build";
import { activateGroupIn, requestGroup } from "./module-group";
import { resolveBuiltinRelease } from "./module-release";
import { currentModuleEvolution, updateModuleEvolution } from "./module-evolution";
import { requestStatus } from "./module-status";
import { rollbackFailedStart } from "./module-generation";
import type { StewardPorts } from "./ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-identity-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "identity" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z") };
  const context = moduleContext(ports, workspace.id);
  async function app(name: string, builtin = false, source = "user") {
    const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [] });
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
  await writeFile(join(f.dataDir, "candidate/module.json"), JSON.stringify({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [] }));
  await writeFile(join(f.dataDir, "candidate/index.ts"), "export {};");
  await expect(propose(f.context, { root: f.dataDir, dir: "candidate", intent: request(name).intent }, "user")).rejects.toMatchObject({ code: "forbidden" });
  expect(await f.db.module.count()).toBe(0);
  expect(await f.db.moduleVersion.count()).toBe(0);
  expect(await f.db.session.count()).toBe(0);
  expect(await f.db.run.count()).toBe(0);
  expect(await f.db.approval.count()).toBe(0);
});

test.each(["activate", "switch", "rollback", "restore-approval", "group-approval"])("%s rejects a builtin with source=user and preserves current code", async operation => {
  const f = await fixture(), app = await f.app("files", true);
  const payload = operation === "group-approval" ? { kind: "activate_modules", versions: [{ moduleId: app.id, hash: "next" }, { moduleId: "other", hash: "next" }] } : { kind: "activate_module", moduleId: app.id, hash: "next", restore: { schema: 1, snapshotAt: "snapshot" } };
  const approval = await f.db.approval.create({ data: { workspaceId: f.workspace.id, moduleId: operation === "group-approval" ? null : app.id, action: "activate_module", status: "approved", title: "old request", detail: "", preview: "", payload } });
  const action = { workspaceId: f.workspace.id, approvalId: approval.id, payload };
  const perform = () => f.db.$transaction(async tx => {
    if (operation === "activate") return activateIn(f.context, tx, { moduleId: app.id, hash: "next", reason: "activate" });
    if (operation === "switch") return switchActiveIn(f.context, tx, app.id, "next");
    if (operation === "group-approval") return activateGroupIn(f.context, tx, action);
    return activateApprovedIn(f.context, tx, action);
  });
  await expect(operation === "rollback" ? rollback(f.context, app.id, "next") : perform()).rejects.toMatchObject({ code: "forbidden" });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).activeHash).toBe("old");
  expect(await f.db.generation.count()).toBe(0);
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
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: app.id, hash: "next" } }, data: { manifest: { ...app.manifest, triggers: [{ id: "daily", schedule: { kind: "daily", time: "09:00" } }] } } });
  const dynamic = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: app.id, mode: "module", triggerId: "timer", rule: { kind: "at", at: "2026-12-01T12:00:00Z" }, payload: { task: "later" }, text: "later", createdBy: "example", nextAt: new Date("2026-12-01T12:00:00Z") } });
  const independentlyPaused = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: app.id, mode: "module", triggerId: "manual", rule: { kind: "at", at: "2026-12-01T12:00:00Z" }, payload: { task: "manual" }, text: "manual", createdBy: "example", status: "paused" } });
  await requestStatus(f.context, app.id, "paused", "maintenance");
  await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: app.id, hash: "next", reason: "activate" }));
  expect((await f.db.module.findUniqueOrThrow({ where: { id: app.id } }))).toMatchObject({ activeHash: "next", builtin: false, status: "paused" });
  expect(await f.db.schedule.findFirstOrThrow({ where: { moduleId: app.id, triggerId: "daily" } })).toMatchObject({ status: "paused", nextAt: null });
  await requestStatus(f.context, app.id, "active", "explicit enable");
  expect(await f.db.schedule.findFirstOrThrow({ where: { moduleId: app.id, triggerId: "daily" } })).toMatchObject({ status: "active", nextAt: expect.any(Date) });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: dynamic.id } })).toMatchObject({ status: "active", nextAt: expect.any(Date) });
  expect(await f.db.schedule.findUniqueOrThrow({ where: { id: independentlyPaused.id } })).toMatchObject({ status: "paused", nextAt: null });
});

test("trusted release activation is idempotent and rejects caller tampering", async () => {
  const f = await fixture();
  f.ports.moduleBuiltinResources = join(f.dataDir, "release");
  await mkdir(join(f.ports.moduleBuiltinResources, "files"), { recursive: true });
  const app = await f.app("files", true);
  await writeFile(join(f.ports.moduleBuiltinResources, "files/module.json"), JSON.stringify(app.manifest));
  await writeFile(join(f.ports.moduleBuiltinResources, "files/index.ts"), "export {};");
  const release = await resolveBuiltinRelease(f.ports, "files");
  await f.db.moduleVersion.create({ data: { moduleId: app.id, hash: release.hash, manifest: release.manifest, source: "builtin", status: "approved", intent: {}, report: {} } });
  await requestStatus(f.context, app.id, "paused", "maintenance");
  await f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release));
  const evolution = await currentModuleEvolution(f.db, f.workspace.id, app.id, release.hash);
  await f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release));
  expect(await f.db.generation.count()).toBe(1);
  expect(await currentModuleEvolution(f.db, f.workspace.id, app.id, release.hash)).toEqual(evolution);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ activeHash: release.hash, status: "paused" });
  await expect(f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, { ...release, codeDir: f.dataDir }))).rejects.toMatchObject({ code: "conflict" });
  await writeFile(join(release.codeDir, "index.ts"), "changed");
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

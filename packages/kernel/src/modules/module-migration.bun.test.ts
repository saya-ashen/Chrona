import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "../__testing__/test-db";
import { moduleContext } from "./module-context";
import { startMigration } from "./module-generation";
import { migrateData, recoverMigrations } from "./module-migration";
import { activateApprovedIn } from "./module-activation";
import { completeApprovedOperationsIn } from "./module-operation-result";
import { requestStatus } from "./module-status";
import type { StewardPorts } from "../ports";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0).reverse()) await close(); });

test("a leftover data-old from a committed migration never replaces current data", async () => {
  await mkdir(".tmp", { recursive: true });
  const db = testDb(), dataDir = await mkdtemp(join(process.cwd(), ".tmp", "chrona-stale-migration-"));
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "stale migration recovery" } });
  const now = new Date("2026-11-05T12:00:00Z");
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => now, sandbox: { available: true, isolated: true, async runModule(input) {
    await writeFile(join(input.dataDir, "value.txt"), "migrated");
    return { status: "succeeded", output: "", error: null, exitCode: 0 };
  } } };
  const context = moduleContext(ports, workspace.id);
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "old", dataSchema: 1, status: "active" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, data: { schema: 2, migrate: "migrate.ts" } });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: "next", source: "user", manifest, intent: {}, report: {}, status: "pending_review" } });
  const live = join(context.platform, "data", module.id), old = join(context.platform, "data-old", module.id);
  await mkdir(live, { recursive: true });
  await writeFile(join(live, "value.txt"), "original");
  await db.$transaction(tx => startMigration(context, tx, module.id, version.hash, { from: 1, to: 2 }));
  await migrateData(context, { module, version, manifest, from: 1, to: 2 }, "activate");
  expect(await readFile(join(live, "value.txt"), "utf8")).toBe("migrated");

  // Simulate a committed migration's cleanup being interrupted, then new user writes.
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "stale.txt"), "stale data from the previous migration");
  await writeFile(join(live, "current.txt"), "current user data");
  const nextManifest = moduleManifestSchema.parse({ ...manifest, data: { schema: 3, migrate: "migrate.ts" } });
  const nextVersion = await db.moduleVersion.create({ data: { moduleId: module.id, hash: "newer", source: "user", manifest: nextManifest, intent: {}, report: {}, status: "pending_review" } });
  const payload = { kind: "activate_module", moduleId: module.id, hash: nextVersion.hash };
  const approval = await db.approval.create({ data: { workspaceId: workspace.id, moduleId: module.id, action: "activate_module", status: "approved", title: "migrate", detail: "migrate", preview: "migrate", payload, resolvedAt: now } });
  const prepared = await db.$transaction(tx => activateApprovedIn(context, tx, { workspaceId: workspace.id, approvalId: approval.id, payload }));
  expect(prepared).toBeTruthy();
  // Crash after admission commits, before migrateData prepares or swaps any directory.
  now.setTime(now.getTime() + 16 * 60_000);
  await recoverMigrations(context);
  expect(await readFile(join(live, "current.txt"), "utf8")).toBe("current user data");
  await expect(readFile(join(live, "stale.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test.each([false, true])("paused app migration preserves state and data (failure=%s)", async failure => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-paused-migration-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "migration" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z"), sandbox: { available: true, isolated: true, async runModule(input) {
    await writeFile(join(input.dataDir, "value.txt"), "migrated");
    return { status: failure ? "failed" : "succeeded", output: "", error: failure ? "synthetic failure" : null, exitCode: failure ? 1 : 0 };
  } } };
  const context = moduleContext(ports, workspace.id);
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "old", dataSchema: 1, status: "paused" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, data: { schema: 2, migrate: "migrate.ts" } });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: "next", source: "user", manifest, intent: {}, report: {}, status: "pending_review" } });
  const timer = await db.timer.create({ data: { workspaceId: workspace.id, moduleId: module.id, timerId: "retained legacy timer", rule: { kind: "every", minutes: 60 }, status: "cancelled", nextAt: null } });
  const data = join(context.platform, "data", module.id);
  await mkdir(data, { recursive: true }); await writeFile(join(data, "value.txt"), "original");
  await db.$transaction(tx => startMigration(context, tx, module.id, version.hash, { from: 1, to: 2 }));
  await migrateData(context, { module, version, manifest, from: 1, to: 2 }, "activate");
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "paused", activeHash: failure ? "old" : "next", dataSchema: failure ? 1 : 2 });
  expect(await readFile(join(data, "value.txt"), "utf8")).toBe(failure ? "original" : "migrated");
  expect(await db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ status: failure ? "rejected" : "approved" });
  expect(await db.timer.findMany({ where: { moduleId: module.id } })).toMatchObject([{ id: timer.id, status: "cancelled", nextAt: null }]);
  await requestStatus(context, module.id, "active", "explicit enable");
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "active", activeHash: failure ? "old" : "next", dataSchema: failure ? 1 : 2 });
  expect(await db.timer.findMany({ where: { moduleId: module.id } })).toMatchObject([{ id: timer.id, status: "cancelled", nextAt: null }]);
});

test.each([false, true])("migration completion shares the activation transaction and data swap (callback failure=%s)", async failure => {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-migration-completion-");
  closes.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "migration completion" } });
  const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date("2026-11-05T12:00:00Z"), sandbox: { available: true, isolated: true, async runModule(input) {
    await writeFile(join(input.dataDir, "value.txt"), "migrated");
    return { status: "succeeded", output: "", error: null, exitCode: 0 };
  } } };
  const context = moduleContext(ports, workspace.id);
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example", activeHash: "old", dataSchema: 1, status: "active" } });
  const manifest = moduleManifestSchema.parse({ name: module.name, entry: "index.ts", tests: ["test.ts"], effects: [], keepAlive: true, data: { schema: 2, migrate: "migrate.ts" } });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: "next", source: "user", manifest, intent: {}, report: {}, status: "approved" } });
  const approval = await db.approval.create({ data: { workspaceId: workspace.id, action: "activate_module", status: "approved", title: "restore", detail: "restore", preview: "restore", payload: {}, resolvedAt: ports.now() } });
  const receipt = { operationId: "migration-rollback", moduleId: module.id, status: "pending_approval", approvalId: approval.id };
  const invocation = await db.moduleInvocation.create({ data: { id: receipt.operationId, workspaceId: workspace.id, caller: "owner", target: "modules", targetIdentity: "system:modules", tool: "rollback", args: { moduleId: module.id, hash: version.hash, reason: "restore" }, key: "rollback-once", mode: "sync", status: "succeeded", output: receipt } });
  const completed = { ...receipt, status: "done", result: { moduleId: module.id, status: "active", activeHash: version.hash } };
  const live = join(context.platform, "data", module.id);
  await mkdir(live, { recursive: true }); await writeFile(join(live, "value.txt"), "original");
  await db.$transaction(tx => startMigration(context, tx, module.id, version.hash, { from: 1, to: 2 }));
  const observations: unknown[] = [];
  const migration = migrateData(context, { module, version, manifest, from: 1, to: 2 }, "rollback", undefined, async tx => {
    await completeApprovedOperationsIn(tx, workspace.id, approval.id);
    // Assert these observations outside migrateData, which handles callback exceptions as migration failures.
    observations.push({
      module: await tx.module.findUniqueOrThrow({ where: { id: module.id } }),
      invocation: await tx.moduleInvocation.findUniqueOrThrow({ where: { id: invocation.id } }),
      data: await readFile(join(live, "value.txt"), "utf8"),
      generations: await tx.generation.count({ where: { workspaceId: workspace.id } }),
      activations: await tx.moduleActivation.count({ where: { moduleId: module.id } }),
    });
    if (failure) throw new Error("synthetic completion failure after caching done");
  });
  if (failure) await expect(migration).rejects.toThrow("模块回滚未完成");
  else await migration;
  expect(observations).toHaveLength(1);
  expect(observations[0]).toMatchObject({
    module: { status: "active", activeHash: "next", dataSchema: 2 },
    invocation: { status: "succeeded", output: receipt, operationOutput: completed },
    data: "migrated", generations: 1, activations: 1,
  });
  expect(await db.module.findUniqueOrThrow({ where: { id: module.id } })).toMatchObject({ status: "active", activeHash: failure ? "old" : "next", dataSchema: failure ? 1 : 2, activationId: failure ? module.activationId : expect.any(String) });
  expect(await readFile(join(live, "value.txt"), "utf8")).toBe(failure ? "original" : "migrated");
  const retained = await db.moduleInvocation.findUniqueOrThrow({ where: { id: invocation.id } });
  expect({ ...retained, operationOutput: null }).toEqual({ ...invocation, operationOutput: null });
  expect(retained.operationOutput).toEqual(failure ? null : completed);
  expect(await db.generation.count({ where: { workspaceId: workspace.id } })).toBe(failure ? 0 : 1);
  expect(await db.moduleActivation.count({ where: { moduleId: module.id } })).toBe(failure ? 0 : 1);
  expect(await db.audit.count({ where: { workspaceId: workspace.id, subjectId: module.id, kind: "module_rollback" } })).toBe(failure ? 0 : 1);
  expect(await db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ status: "approved" });
  await expect(readFile(join(context.platform, "data-old", module.id, "value.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(context.platform, "data-next", module.id, "value.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

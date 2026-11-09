import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { activateBuiltinReleaseIn, activateIn } from "./module-generation";
import type { ModuleRelease } from "./module-release";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(name = "example", builtin = false, status = "active") {
  const db = testDb(); cleanup.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "activation" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name, builtin, status } });
  const context = moduleContext({ db, dataDir: "/not-used-for-activation", publicUrl: null, now: () => new Date("2026-11-04T12:00:00Z") }, workspace.id);
  const manifest = moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] });
  return { db, workspace, module, context, manifest };
}

test("approved application activation records a generation without creating calendar work", async () => {
  const f = await fixture();
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "approved", manifest: f.manifest, source: "user", status: "approved", intent: {}, report: {} } });
  const generation = await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: f.module.id, hash: "approved", reason: "activate" }));
  expect(generation.modules).toEqual({ [f.module.id]: "approved" });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "active", activeHash: "approved" });
  expect(await f.db.schedule.count()).toBe(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

test("activation preserves a pause and cancels undelivered calendar work without parsing its rule", async () => {
  const f = await fixture("example", false, "paused");
  const timer = await f.db.schedule.create({ data: { workspaceId: f.workspace.id, moduleId: f.module.id, mode: "module", status: "paused", rule: {}, text: "retired calendar", createdBy: "chrona" } });
  const delivery = await f.db.moduleInvocation.create({ data: { workspaceId: f.workspace.id, target: f.module.name, caller: "system:schedules", tool: "schedule", mode: "schedule", key: `${timer.id}:recorded`, args: {} } });
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "approved", manifest: f.manifest, source: "user", status: "approved", intent: {}, report: {} } });
  await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: f.module.id, hash: "approved", reason: "activate" }));
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ status: "paused", activeHash: "approved" });
  expect(await f.db.schedule.findMany()).toEqual([expect.objectContaining({ id: timer.id, status: "cancelled", nextAt: null })]);
  expect(await f.db.moduleInvocation.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "cancelled" });
});

test("removing calendar setup retains the approved-version guard", async () => {
  const f = await fixture();
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash: "candidate", manifest: f.manifest, source: "user", status: "pending_review", intent: {}, report: {} } });
  await expect(f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: f.module.id, hash: "candidate", reason: "activate" }))).rejects.toThrow("not approved");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: null });
  expect(await f.db.generation.count()).toBe(0);
});

test("trusted built-in seeding records activation without calendar rows or duplicate generations", async () => {
  const f = await fixture("agent", true);
  const hash = "a".repeat(40);
  const release: ModuleRelease = { name: "agent", origin: "builtin", hash, manifest: f.manifest, codeDir: "/not-used-for-activation", git: { commit: hash, repository: null, branch: "main", bundlePath: "/not-used" } };
  await f.db.moduleVersion.create({ data: { moduleId: f.module.id, hash, manifest: f.manifest, source: "builtin", status: "approved", intent: {}, report: { git: { commit: hash } } } });
  const first = await f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release));
  const second = await f.db.$transaction(tx => activateBuiltinReleaseIn(f.context, tx, release));
  expect(second.id).toBe(first.id);
  expect(first.modules).toEqual({ [f.module.id]: hash });
  expect(await f.db.schedule.count()).toBe(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

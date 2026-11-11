import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { moduleContext } from "./module-context";
import { activateIn } from "./module-generation";
import { propose } from "./module-proposal";
import { seedTestModuleRelease } from "./module-release-test-fixture";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(name = "example", status = "active") {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-generation-");
  cleanup.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "activation" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name, status } });
  const context = moduleContext({ db, dataDir, publicUrl: null, now: () => new Date("2026-11-04T12:00:00Z") }, workspace.id);
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
  const f = await fixture("example", "paused");
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

test("approved ordinary Pi release activates once and proposal replay creates no calendar work or duplicate generation", async () => {
  const f = await fixture("pi"), resources = join(f.context.ports.dataDir, "external"), code = join(resources, "pi");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "module.json"), JSON.stringify(f.manifest));
  await writeFile(join(code, "index.ts"), "export {};\n");
  await writeFile(join(code, "test.ts"), "export {};\n");
  const git = await seedTestModuleRelease(resources, "pi");
  const input = { root: resources, dir: "pi", sourceCommit: git.commit, gitBundle: git, intent: { changes: ["Offline Pi release"] } };
  const candidate = await propose(f.context, input, "user"), hash = candidate.hash;
  expect(candidate).toMatchObject({ moduleId: f.module.id, hash: git.commit, status: "building" });
  await f.db.moduleVersion.update({ where: { moduleId_hash: { moduleId: f.module.id, hash } }, data: { status: "approved" } });
  // Provide the exact runtime material so activation never restores dependencies.
  await cp(code, join(f.context.store, hash), { recursive: true });
  const first = await f.db.$transaction(tx => activateIn(f.context, tx, { moduleId: f.module.id, hash, reason: "activate" }));
  expect(await propose(f.context, input, "user")).toMatchObject({ moduleId: f.module.id, hash, status: "approved" });
  expect(await f.db.generation.findMany()).toEqual([first]);
  expect(first.modules).toEqual({ [f.module.id]: hash });
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ name: "pi", builtin: false, status: "active", activeHash: hash });
  expect(await f.db.moduleVersion.count({ where: { moduleId: f.module.id } })).toBe(1);
  expect(await f.db.schedule.count()).toBe(0);
  expect(await f.db.moduleInvocation.count()).toBe(0);
});

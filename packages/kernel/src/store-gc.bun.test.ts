import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectStore } from "./store-gc";
import { moduleSupervisor } from "./modules/module-supervisor";
import { readStoredVersionMaterial, storeVersionMaterial, withMaterialPublication } from "./modules/module-artifacts";
import { testDb } from "./__testing__/test-db";
import type { StewardPorts } from "./ports";

const DAY_MS = 24 * 3600_000;
const now = new Date("2026-11-12T12:00:00Z");
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/store-gc-test-");
  const ports: StewardPorts = { db, dataDir, now: () => now, publicUrl: null };
  cleanups.push(async () => {
    await moduleSupervisor(ports).stop();
    await db.$disconnect();
    await rm(dataDir, { recursive: true, force: true });
  });
  const workspace = await db.workspace.create({ data: { name: "store-gc" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "example" } });
  const platform = join(dataDir, "platform"), store = join(platform, "store");
  await mkdir(store, { recursive: true });
  async function material(name: string) {
    const artifact = name === "unique" ? name : "shared artifact";
    const files = [
      { path: "index.ts", bytes: Buffer.from(name) },
      { path: "module.json", bytes: Buffer.from("{}") },
      { path: "artifact", bytes: Buffer.from(artifact) },
      { path: "chrona-material.json", bytes: Buffer.from(JSON.stringify({
        schema: 1, source: ["index.ts", "module.json"], artifacts: [{ path: "artifact", sha256: digest(artifact) }],
        build: { commands: ["true"], toolchain: "offline fixture", target: "fixture" },
      })) },
    ];
    const hash = await storeVersionMaterial(platform, files);
    await mkdir(join(store, hash), { recursive: true });
    return hash;
  }
  async function version(name: string, { age = 31, status = "approved", moduleId = module.id } = {}) {
    return db.moduleVersion.create({ data: { moduleId, hash: await material(name), manifest: {}, source: "user", intent: {}, report: {},
      status, createdAt: new Date(now.getTime() - age * DAY_MS) } });
  }
  return { db, ports, workspace, module, platform, store, version, material };
}

test("daily collection expires old version records and reclaims both checkout and unshared material", async () => {
  const f = await fixture();
  const unique = await f.version("unique"), shared = await f.version("shared"), kept = await f.version("keep", { age: 30 });
  const orphan = await f.material("orphan");
  await mkdir(join(f.store, ".restore-in-progress"));
  await writeFile(join(f.store, "ordinary-file"), "preserve");
  expect(await collectStore(f.ports, now)).toMatchObject({ versionsRemoved: 2, checkoutsRemoved: 3, indexesRemoved: 3 });
  expect(await f.db.moduleVersion.findMany({ select: { hash: true } })).toEqual([{ hash: kept.hash }]);
  expect((await readdir(f.store)).sort()).toEqual([".restore-in-progress", kept.hash, "ordinary-file"].sort());
  expect(await readdir(join(f.platform, "materials/sha256"))).toEqual([kept.hash]);
  const objects = await readdir(join(f.platform, "artifacts/sha256"));
  expect(objects).not.toContain(digest("unique"));
  expect(objects).not.toContain(digest("orphan"));
  expect(objects).toContain(digest("shared artifact"));
  for (const hash of [unique.hash, shared.hash, orphan]) await expect(readStoredVersionMaterial(f.platform, hash)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readStoredVersionMaterial(f.platform, kept.hash)).map(file => file.path)).toContain("artifact");
  expect(await collectStore(f.ports, new Date(now.getTime() + DAY_MS - 1))).toBeUndefined();
  expect(await collectStore(f.ports, new Date(now.getTime() + DAY_MS))).toMatchObject({ versionsRemoved: 1, checkoutsRemoved: 1 });
  expect(await readdir(join(f.platform, "artifacts/sha256"))).toEqual([]);
});

test("active, running, rollback, migration, approval, and installation dependencies survive collection", async () => {
  const f = await fixture(), active = await f.version("active"), previous = await f.version("previous"), live = await f.version("live");
  const pending = await f.version("pending", { status: "pending_review" }), restore = await f.version("restore");
  const migration = await f.version("migration"), installation = await f.version("installation"), obsolete = await f.version("obsolete");
  const recovery = await f.version("recovery", { status: "rejected" });
  const moduleId = f.module.id, workspaceId = f.workspace.id;
  await f.db.module.update({ where: { id: moduleId }, data: { activeHash: active.hash, status: "migrating" } });
  await f.db.moduleActivation.create({ data: { activationId: "latest", moduleId, candidateHash: active.hash, previousHash: previous.hash,
    activatedAt: now.toISOString(), status: "awaiting-verification", changes: [], checks: {}, observedCapabilities: [], dataHandling: "",
    nextAction: "", rollback: {}, createdAt: now, updatedAt: now } });
  await f.db.moduleMigration.create({ data: { moduleId, hash: migration.hash, toSchema: 2, previousStatus: "active", createdAt: now } });
  await f.db.approval.create({ data: { workspaceId, moduleId, action: "activate_module", title: "Restore", detail: "", preview: "",
    payload: { kind: "activate_module", moduleId, hash: restore.hash, restore: { schema: 1 } }, status: "approved", resolvedAt: now } });
  await f.db.moduleInstallation.create({ data: { id: "install", workspaceId, moduleId, requestKey: "install", package: f.module.name, hash: installation.hash,
    status: "building", mode: "update" } });
  await f.db.moduleInstallation.create({ data: { id: "recover", workspaceId, requestKey: "recover", package: f.module.name,
    status: "pending", mode: "update", submission: { create: { id: "submission", hash: recovery.hash, phase: "proposing",
      existingVersionId: recovery.id, marker: "marker" } } } });
  const running = spyOn(moduleSupervisor(f.ports), "liveHashes").mockReturnValue(new Set([live.hash]));
  try {
    expect(await collectStore(f.ports, now)).toMatchObject({ versionsRemoved: 1, checkoutsRemoved: 1 });
    const hashes = [active, previous, live, pending, restore, migration, installation, recovery].map(version => version.hash).sort();
    expect((await readdir(f.store)).sort()).toEqual(hashes);
    expect((await readdir(join(f.platform, "materials/sha256"))).sort()).toEqual(hashes);
    expect(await f.db.moduleVersion.findUnique({ where: { id: obsolete.id } })).toBeNull();
  } finally { running.mockRestore(); }
});

test("a new publication wins against the collector and pins a shared version hash", async () => {
  const f = await fixture(), expired = await f.version("same");
  const other = await f.db.module.create({ data: { workspaceId: f.workspace.id, name: "other" } });
  const publicationStarted = Promise.withResolvers<void>(), publicationMayFinish = Promise.withResolvers<void>();
  const publication = withMaterialPublication(f.platform, async () => {
    const hash = await f.material("same");
    publicationStarted.resolve();
    await publicationMayFinish.promise;
    return f.db.moduleVersion.create({ data: { moduleId: other.id, hash, manifest: {}, source: "user", intent: {}, report: {},
      status: "building", createdAt: now } });
  });
  await Promise.race([publicationStarted.promise, publication]);
  const collection = collectStore(f.ports, now);
  publicationMayFinish.resolve();
  await publication;
  expect(await collection).toMatchObject({ versionsRemoved: 1, checkoutsRemoved: 0, indexesRemoved: 0, objectsRemoved: 0 });
  expect(await f.db.moduleVersion.findUnique({ where: { id: expired.id } })).toBeNull();
  expect(await readStoredVersionMaterial(f.platform, expired.hash)).toHaveLength(4);
});

test.each(["missing", "changed"])("a %s retained index leaves shared objects for a later pass", async damage => {
  const f = await fixture(), retained = await f.version("retained", { age: 0 });
  await f.material("unique");
  const index = join(f.platform, "materials/sha256", retained.hash, "bytes");
  const text = await Bun.file(index).text();
  await rm(index);
  if (damage === "changed") await writeFile(index, text.replace(digest("retained"), digest("unique")));
  await expect(collectStore(f.ports, now)).rejects.toThrow("Cannot verify retained material");
  const objects = await readdir(join(f.platform, "artifacts/sha256"));
  expect(objects).toContain(digest("unique"));
  expect(objects).toContain(digest("retained"));
});

test("protected rows do not consume the daily deletion batch", async () => {
  const f = await fixture(), createdAt = new Date(now.getTime() - 60 * DAY_MS);
  const row = { moduleId: f.module.id, manifest: {}, intent: {}, source: "user", report: {}, status: "approved", createdAt };
  await f.db.moduleVersion.create({ data: { ...row, hash: "active", createdAt: new Date(0) } });
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: "active" } });
  await f.db.moduleVersion.createMany({ data: Array.from({ length: 201 }, (_, index) => ({ ...row, hash: `old-${index}` })) });
  expect(await collectStore(f.ports, now)).toMatchObject({ versionsRemoved: 200 });
  expect(await collectStore(f.ports, new Date(now.getTime() + DAY_MS))).toMatchObject({ versionsRemoved: 1 });
  expect(await f.db.moduleVersion.findMany({ select: { hash: true } })).toEqual([{ hash: "active" }]);
});

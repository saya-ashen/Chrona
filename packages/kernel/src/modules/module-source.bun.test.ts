import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleContext } from "./module-context";
import { moduleSourceFiles, snapshotModuleMaterial, storeVersionMaterial } from "./module-artifacts";
import { readVersionSource } from "./module-source";
import { propose } from "./module-proposal";
import { seedTestModuleRelease } from "../__testing__/module-release-test-fixture";
import { testDb } from "../__testing__/test-db";
import type { StewardPorts } from "../ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-module-source-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "source" } });
  const context = moduleContext({ db, dataDir, now: () => new Date() } as StewardPorts, workspace.id);
  const resources = join(dataDir, "external"), code = join(resources, "fixture");
  await mkdir(code, { recursive: true });
  await writeFile(join(code, "module.json"), JSON.stringify({ name: "fixture", entry: "index.ts", keepAlive: true, effects: [] }));
  await writeFile(join(code, "index.ts"), "export {};\n");
  const release = await seedTestModuleRelease(resources, "fixture");
  const files = await snapshotModuleMaterial(resources, "fixture");
  return { db, context, resources, code, release, files };
}
test("source remains exact after submitted and runtime copies change or disappear", async () => {
  const f = await fixture();
  const proposal = await propose(f.context, { root: f.resources, dir: "fixture", expectedHash: f.release.hash, intent: { changes: ["Offline fixture"] } }, "user");
  expect(proposal).toMatchObject({ hash: f.release.hash, status: "building" });
  const expected = moduleSourceFiles(f.files);
  const runtime = join(f.context.store, proposal.hash);
  await mkdir(runtime, { recursive: true });
  await writeFile(join(runtime, "index.ts"), "runtime pollution");
  await writeFile(join(f.code, "index.ts"), "new release");
  expect(await readVersionSource(f.context, proposal.moduleId!, proposal.hash)).toEqual(expected);
  await rm(runtime, { recursive: true });
  await rm(f.code, { recursive: true });
  expect(await readVersionSource(f.context, proposal.moduleId!, proposal.hash)).toEqual(expected);
  await expect(readVersionSource({ ...f.context, workspaceId: "other" }, proposal.moduleId!, proposal.hash)).rejects.toMatchObject({ code: "not_found" });
});
test("a missing retained source is not imported from a mutable store copy", async () => {
  const f = await fixture(), hash = await storeVersionMaterial(f.context.platform, f.files);
  const module = await f.db.module.create({ data: { workspaceId: f.context.workspaceId, name: "fixture" } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: {}, intent: {}, source: "user", status: "approved", report: {} } });
  const index = join(f.context.platform, "materials/sha256", hash, "bytes");
  const saved = await readFile(index);
  await rm(index);
  await expect(readVersionSource(f.context, module.id, hash)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(index, saved);
  expect(await readVersionSource(f.context, module.id, hash)).toEqual(moduleSourceFiles(f.files));
});
test("retired Git identities cannot select version material", async () => {
  const f = await fixture(), module = await f.db.module.create({ data: { workspaceId: f.context.workspaceId, name: "fixture" } });
  const hash = "a".repeat(40);
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: {}, intent: {}, source: "user", status: "approved", report: {} } });
  await expect(readVersionSource(f.context, module.id, hash)).rejects.toMatchObject({ code: "invalid" });
});

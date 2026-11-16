import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { testDb } from "../test-db";
import { externalPackageCatalog, installExternal, installationId } from "./module-install";
import { resolveExternalRelease } from "./module-release";
import { readModuleFiles } from "./module-preview";
import type { StewardPorts } from "../ports";
import { PAUSED_MODULE_NAMES } from "./module-availability";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function sourceDigest(source: string) {
  const digest = createHash("sha256");
  for (const file of await readModuleFiles(source, "Unsafe retained test source")) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  return digest.digest("hex");
}

test.each([...PAUSED_MODULE_NAMES])("retained %s sources cannot become an installable runtime package", async name => {
  const dataDir = await mkdtemp("/tmp/chrona-paused-install-"), db = testDb();
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "paused packages" } });
  const resources = join(dataDir, "external"), source = resolve(import.meta.dirname, "../applications", name), retained = join(resources, name);
  await cp(source, retained, { recursive: true });
  const before = await sourceDigest(retained);
  const manifest = JSON.parse(await readFile(join(retained, "module.json"), "utf8")) as { name: string; entry: string; tests: string[] };
  expect(manifest.name).toBe(name);
  for (const entry of [manifest.entry, ...manifest.tests]) expect((await readFile(join(retained, entry))).byteLength).toBeGreaterThan(0);
  let submissions = 0;
  const ports: StewardPorts = { db, dataDir, moduleExternalResources: resources, now: () => new Date("2026-11-08T12:00:00Z"), publicUrl: null,
    moduleExternalInstaller: async () => { submissions++; throw new Error("Paused package reached installer"); } };
  const request = { package: name, mode: "install" as const, requestKey: "paused" };
  const unavailable = { code: "unavailable", reason: "module_paused" };
  for (const attempt of [request, request, { ...request, mode: "update" as const, requestKey: "paused-update" }]) {
    await expect(installExternal(ports, workspace.id, attempt)).rejects.toMatchObject(unavailable);
  }
  expect(await db.moduleInstallation.count()).toBe(0);
  expect((await externalPackageCatalog(ports, workspace.id)).find(item => item.name === name)).toMatchObject({ available: false, releaseHash: null, installation: null, error: expect.stringContaining("unavailable: paused") });
  await expect(resolveExternalRelease(ports, name)).rejects.toMatchObject(unavailable);
  expect(submissions).toBe(0);
  expect(await db.module.count()).toBe(0);
  expect(await db.moduleVersion.count()).toBe(0);
  expect(await db.run.count()).toBe(0);

  // A receipt created before the pause must replay only the unavailable outcome.
  const existing = await db.module.create({ data: { workspaceId: workspace.id, name, activeHash: "a".repeat(40) } });
  const result = { package: name, requestKey: request.requestKey, status: "installed", moduleId: existing.id, hash: existing.activeHash, approvalId: null, error: null };
  const id = installationId(workspace.id, request.requestKey);
  await db.moduleInstallation.create({ data: { id, workspaceId: workspace.id, ...request, status: result.status, moduleId: result.moduleId, hash: result.hash, approvalId: result.approvalId } });
  const replay = await installExternal(ports, workspace.id, request);
  expect(replay).toMatchObject({ ...result, status: "unavailable", error: unavailable });
  expect(await installExternal(ports, workspace.id, request)).toEqual(replay);
  expect(await db.moduleInstallation.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "unavailable", errorReason: replay.error?.reason });
  await expect(installExternal(ports, workspace.id, { ...request, mode: "update" })).rejects.toMatchObject({ code: "conflict" });
  await expect(installExternal(ports, workspace.id, { ...request, mode: "update", requestKey: "existing-paused-update" })).rejects.toMatchObject(unavailable);
  expect(await db.module.findUniqueOrThrow({ where: { id: existing.id } })).toEqual(existing);
  expect(await db.moduleVersion.count()).toBe(0);
  expect(await db.run.count()).toBe(0);
  expect(submissions).toBe(0);
  expect(await sourceDigest(retained)).toBe(before);
  expect(await sourceDigest(source)).toBe(before);
});

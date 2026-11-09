import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { installExternal } from "./module-install";
import { readModuleFiles } from "./module-preview";
import { resolveExternalRelease } from "./module-release";
import type { StewardPorts } from "./ports";
import { testDb } from "./test-db";

// Restoring Coding still requires an authentic pinned release before installation can run.
test("Coding restoration preserves source and rejects installation without its pinned Git release", async () => {
  const dataDir = await mkdtemp("/tmp/chrona-coding-release-"), db = testDb();
  try {
    const source = join(import.meta.dirname, "external", "coding"), resources = join(dataDir, "external"), code = join(resources, "coding");
    const retained = (await readModuleFiles(source, "Unsafe retained Coding source")).sort((a, b) => a.path.localeCompare(b.path));
    expect(retained.map(file => file.path)).toEqual(expect.arrayContaining(["module.json", "index.ts", "test.ts"]));
    await mkdir(resources); await cp(source, code, { recursive: true });
    expect((await readModuleFiles(code, "Unsafe Coding copy")).sort((a, b) => a.path.localeCompare(b.path))).toEqual(retained);
    const workspace = await db.workspace.create({ data: { name: "Coding release validation" } });
    let installations = 0;
    const ports: StewardPorts = { db, dataDir, publicUrl: null, now: () => new Date(), moduleExternalResources: resources,
      moduleExternalInstaller: async () => { installations++; throw new Error("Coding release validation must not execute its installer or author tests"); } };
    const unavailable = { code: "not_found", reason: "release_not_found" };
    await expect(resolveExternalRelease(ports, "coding")).rejects.toMatchObject(unavailable);
    expect(await installExternal(ports, workspace.id, { package: "coding", mode: "install", requestKey: "unverified-coding" })).toMatchObject({ status: "failed", error: unavailable });
    expect(installations).toBe(0);
    expect(await db.module.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect(await db.moduleVersion.count({ where: { module: { workspaceId: workspace.id } } })).toBe(0);
    expect(await db.approval.count({ where: { workspaceId: workspace.id } })).toBe(0);
    expect((await readModuleFiles(source, "Unsafe retained Coding source")).sort((a, b) => a.path.localeCompare(b.path))).toEqual(retained);
    expect((await readModuleFiles(code, "Unsafe Coding copy")).sort((a, b) => a.path.localeCompare(b.path))).toEqual(retained);
  } finally { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); }
});

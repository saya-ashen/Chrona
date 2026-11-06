import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { registerBuiltins } from "./module-builtin";
import { resolveBuiltinRelease } from "./module-release";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-release-test-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "Release" } });
  let executions = 0;
  const ports: StewardPorts = { db, dataDir, now: () => new Date("2026-11-05T00:00:00Z"), publicUrl: null, moduleBuiltinResources: join(dataDir, "builtin"), sandbox: {
    available: true, isolated: false,
    startModule() { executions++; throw new Error("Registrar must not start module processes"); },
    async runModule() { executions++; throw new Error("Registrar must not execute author tests"); },
  } };
  async function write(name: string, revision: number, extra: Record<string, unknown> = {}) {
    const dir = join(ports.moduleBuiltinResources!, name); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "module.json"), JSON.stringify(moduleManifestSchema.parse({ name, entry: "index.ts", keepAlive: true, tests: ["test.ts"], triggers: [], effects: [], ...extra })));
    await writeFile(join(dir, "index.ts"), `// release ${revision}\n`);
    await writeFile(join(dir, "test.ts"), "// author checked before release\n");
  }
  for (const name of BUILTIN_MODULE_NAMES) await write(name, 1);
  const current = (name = "web") => db.module.findUniqueOrThrow({ where: { workspaceId_name: { workspaceId: workspace.id, name } } });
  return { db, ports, workspaceId: workspace.id, write, current, executions: () => executions, start: () => registerBuiltins(ports, workspace.id) };
}

test("fixed builtins bind approved trusted release metadata without builds or extra directory registration", async () => {
  const f = await fixture();
  await f.write("surprise", 1);
  await f.start();
  expect((await f.db.module.findMany()).map(m => m.name).sort()).toEqual([...BUILTIN_MODULE_NAMES].sort());
  expect(await f.current()).toMatchObject({ builtin: true, status: "active", dataSchema: 1 });
  expect(await f.db.moduleVersion.findMany()).toHaveLength(5);
  expect(await f.db.moduleVersion.count({ where: { status: "approved", source: "builtin" } })).toBe(5);
  expect(await f.db.approval.count()).toBe(0);
  expect(await f.db.generation.count()).toBe(5);
  const hash = (await f.current()).activeHash;
  await f.start();
  expect((await f.current()).activeHash).toBe(hash);
  expect(await f.db.generation.count()).toBe(5);
  expect(f.executions()).toBe(0);
});

test("release upgrade replaces selected builtin code, preserves pause and emits a new activation", async () => {
  const f = await fixture(); await f.start();
  const first = await f.current();
  await f.db.module.update({ where: { id: first.id }, data: { status: "paused" } });
  await f.write("web", 2);
  await f.start();
  const release = await resolveBuiltinRelease(f.ports, "web");
  expect(await f.current()).toMatchObject({ activeHash: release.hash, status: "paused", dataSchema: 1 });
  expect(release.hash).not.toBe(first.activeHash);
  expect(await f.db.generation.count()).toBe(6);
  expect(await f.db.audit.count({ where: { subjectId: first.id, kind: "module_evolution_outcome" } })).toBe(2);
  expect(f.executions()).toBe(0);
});

test("data incompatibility pauses the builtin and preserves data and previous code metadata", async () => {
  const f = await fixture(); await f.start(); const first = await f.current();
  const dir = join(f.ports.dataDir, "platform/data", first.id); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "owner.json"), "{\"keep\":true}");
  await f.write("web", 2, { data: { schema: 2 } });
  await expect(f.start()).rejects.toThrow("back up");
  expect(await f.current()).toMatchObject({ status: "paused", activeHash: first.activeHash, dataSchema: 1 });
  expect(await readFile(join(dir, "owner.json"), "utf8")).toBe('{"keep":true}');
  const release = await resolveBuiltinRelease(f.ports, "web");
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: first.id, hash: release.hash } } })).toMatchObject({ report: { errors: [expect.stringContaining("schema differs")] } });
});

test("missing runtime or host dependency reports a paused builtin without running installer", async () => {
  const f = await fixture();
  await f.write("web", 2, { packages: ["chrona-fixture-program-does-not-exist"] });
  await expect(f.start()).rejects.toThrow("Required host program unavailable");
  expect(await f.current()).toMatchObject({ status: "paused", activeHash: null });
  expect(await f.current("files")).toMatchObject({ status: "active" });
  expect(f.executions()).toBe(0);
});

test("read-only hardlinked resources retain their bytes and no private code store is required", async () => {
  const f = await fixture(), path = join(f.ports.moduleBuiltinResources!, "web/index.ts");
  const bytes = await readFile(path);
  await link(path, join(f.ports.dataDir, "same-file")); await chmod(path, 0o444);
  await f.start(); await f.start();
  expect(await readFile(path)).toEqual(bytes);
  expect((await f.current()).activeHash).toBe((await resolveBuiltinRelease(f.ports, "web")).hash);
  expect(f.executions()).toBe(0);
});

test("external row with reserved builtin name fails closed and is never promoted", async () => {
  const f = await fixture();
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "web", builtin: false } });
  await expect(f.start()).rejects.toThrow("identity conflicts");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ builtin: false, activeHash: null });
  expect(await f.db.moduleVersion.count({ where: { moduleId: row.id } })).toBe(0);
});

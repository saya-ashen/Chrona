import { afterEach, expect, test } from "bun:test";
import { chmod, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BUILTIN_MODULE_NAMES, moduleManifestSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { json } from "./module-context";
import { registerBuiltins } from "./module-builtin";
import { resolveBuiltinRelease } from "./module-release";
import { seedTestModuleRelease } from "./module-release-test-fixture";
import { getModuleLocalHead } from "./module-git";
import { getModuleUpstreamHead } from "./module-git-upstream";
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
    await seedTestModuleRelease(ports.moduleBuiltinResources!, name);
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

test("parallel first registrations share the Git seed and activate each builtin once", async () => {
  const f = await fixture();
  for (const name of BUILTIN_MODULE_NAMES) await seedTestModuleRelease(f.ports.moduleBuiltinResources!, name, `https://github.com/chrona-fixture/${name}.git`);
  const starts = [f.start(), registerBuiltins({ ...f.ports }, f.workspaceId), f.start()];
  expect(starts[1]).toBe(starts[0]);
  await Promise.all(starts);
  for (const name of BUILTIN_MODULE_NAMES) {
    const module = await f.current(name), release = await resolveBuiltinRelease(f.ports, name);
    expect(module).toMatchObject({ status: "active", activeHash: release.hash, builtin: true });
    const location = { platform: join(f.ports.dataDir, "platform"), moduleId: module.id };
    expect(await getModuleLocalHead(location)).toBe(release.hash);
    expect(await getModuleUpstreamHead({ ...location, branch: release.git!.branch })).toBe(release.hash);
    expect(await readFile(join(f.ports.dataDir, "platform/store", release.hash, "index.ts"), "utf8")).toBe("// release 1\n");
  }
  expect(await f.db.moduleVersion.count()).toBe(5);
  expect(await f.db.generation.count()).toBe(5);
  await f.start();
  expect(await f.db.generation.count()).toBe(5);
  expect(f.executions()).toBe(0);
});

test.each(["release", "missing", "schema"])("existing active builtin ignores %s release changes and keeps its accepted record", async change => {
  const f = await fixture(); await f.start();
  const first = await f.current();
  const versions = await f.db.moduleVersion.findMany({ where: { moduleId: first.id } });
  const dir = join(f.ports.dataDir, "platform/data", first.id); await mkdir(dir, { recursive: true }); await writeFile(join(dir, "owner.json"), '{"keep":true}');
  if (change === "missing") await rm(f.ports.moduleBuiltinResources!, { recursive: true });
  else await f.write("web", 2, change === "schema" ? { data: { schema: 2 }, packages: ["chrona-fixture-program-does-not-exist"] } : {});
  await f.start();
  expect(await f.current()).toMatchObject({ activeHash: first.activeHash, builtin: true, status: "active", dataSchema: 1 });
  expect(await f.db.moduleVersion.findMany({ where: { moduleId: first.id } })).toEqual(versions);
  expect(await f.db.generation.count()).toBe(5);
  expect(await readFile(join(dir, "owner.json"), "utf8")).toBe('{"keep":true}');
  expect(f.executions()).toBe(0);
});

test("checked builtin customization survives restart, missing release and unavailable runtime", async () => {
  const f = await fixture(); await f.start();
  const module = await f.current(), hash = "a".repeat(40);
  const previous = await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } });
  await f.db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: json(previous.manifest), source: "user", status: "approved", intent: {}, report: { tests: [] } } });
  await f.db.module.update({ where: { id: module.id }, data: { activeHash: hash, status: "paused" } });
  f.ports.sandbox = undefined;
  await rm(f.ports.moduleBuiltinResources!, { recursive: true });
  await f.start();
  expect(await f.current()).toMatchObject({ activeHash: hash, builtin: true, status: "paused" });
  expect(await f.db.moduleVersion.count()).toBe(6);
});

test("missing runtime or host dependency reports a paused builtin without running installer", async () => {
  const f = await fixture();
  await f.write("web", 2, { packages: ["chrona-fixture-program-does-not-exist"] });
  await expect(f.start()).rejects.toThrow("Required host program unavailable");
  expect(await f.current()).toMatchObject({ status: "paused", activeHash: null });
  expect(await f.current("files")).toMatchObject({ status: "active" });
  expect(f.executions()).toBe(0);
});

test("read-only hardlinked release resources retain their bytes and seed a separate runtime store", async () => {
  const f = await fixture(), path = join(f.ports.moduleBuiltinResources!, "web/index.ts");
  const bytes = await readFile(path);
  await link(path, join(f.ports.dataDir, "same-file")); await chmod(path, 0o444);
  await f.start(); await f.start();
  expect(await readFile(path)).toEqual(bytes);
  expect((await f.current()).activeHash).toBe((await resolveBuiltinRelease(f.ports, "web")).hash);
  expect(await readFile(join(f.ports.dataDir, "platform/store", (await f.current()).activeHash!, "index.ts"))).toEqual(bytes);
  expect(f.executions()).toBe(0);
});

test("external row with reserved builtin name fails closed and is never promoted", async () => {
  const f = await fixture();
  const row = await f.db.module.create({ data: { workspaceId: f.workspaceId, name: "web", builtin: false } });
  await expect(f.start()).rejects.toThrow("identity conflicts");
  expect(await f.db.module.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ builtin: false, activeHash: null });
  expect(await f.db.moduleVersion.count({ where: { moduleId: row.id } })).toBe(0);
});


test.each([false, true])("trusted seed prepares runtime dependencies before approval (failure=%s)", async failure => {
  const f = await fixture(), root = f.ports.moduleBuiltinResources!;
  await writeFile(join(root, "web/package.json"), JSON.stringify({ name: "seed-dependency-fixture", private: true }));
  await writeFile(join(root, "web/bun.lock"), "synthetic lock handled by the fixture adapter");
  await seedTestModuleRelease(root, "web", "https://github.com/chrona-fixture/web.git");
  let installs = 0;
  f.ports.packages = { backend: "system", async install({ dir, gcroot }) {
    installs++;
    expect(await readFile(join(dir, "package.json"), "utf8")).toContain("seed-dependency-fixture");
    expect(gcroot).toStartWith(join(f.ports.dataDir, "platform/gcroots"));
    // A separate write transaction must remain possible while dependency work runs.
    await f.db.$transaction(async tx => {
      expect(await tx.moduleVersion.count({ where: { module: { name: "web" } } })).toBe(0);
    });
    if (!failure) {
      await mkdir(join(dir, "node_modules/seed-runtime"), { recursive: true });
      await writeFile(join(dir, "node_modules/seed-runtime/index.js"), "export default 'prepared';");
    }
    return { errors: failure ? ["Seed dependency preparation failed"] : [], installed: { npm: true, python: false, packages: {} } };
  } };
  if (failure) {
    const results = await Promise.allSettled([f.start(), f.start(), registerBuiltins({ ...f.ports }, f.workspaceId)]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.message).toContain("Seed dependency preparation failed");
    }
    const module = await f.current();
    expect(module).toMatchObject({ activeHash: null, status: "paused" });
    expect(await f.db.moduleVersion.count({ where: { moduleId: module.id } })).toBe(0);
    expect(installs).toBe(1);
    const location = { platform: join(f.ports.dataDir, "platform"), moduleId: module.id };
    const local = await getModuleLocalHead(location);
    failure = false;
    await Promise.all([f.start(), f.start()]);
    expect(await f.current()).toMatchObject({ activeHash: local, status: "paused" });
    expect(await getModuleLocalHead(location)).toBe(local);
    expect(await getModuleUpstreamHead({ ...location, branch: (await resolveBuiltinRelease(f.ports, "web")).git!.branch })).toBe(local);
    expect(await f.db.moduleVersion.count()).toBe(5);
    expect(await f.db.generation.count()).toBe(5);
    expect(installs).toBe(2);
  } else {
    await f.start();
    const module = await f.current();
    expect(await readFile(join(f.ports.dataDir, "platform/store", module.activeHash!, "node_modules/seed-runtime/index.js"), "utf8")).toContain("prepared");
    expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { moduleId_hash: { moduleId: module.id, hash: module.activeHash! } } })).toMatchObject({ source: "builtin", status: "approved", report: { dependencies: { npm: true } } });
    expect(installs).toBe(1);
  }
  expect(f.executions()).toBe(0);
});

import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StewardPorts } from "../ports";

// Set this before importing engine modules, which initialize the database singleton.
const databaseRoot = mkdtempSync(join(tmpdir(), "chrona-recovery-db-"));
process.env.DATABASE_URL = `file:${join(databaseRoot, "test.db")}`;
const [{ moduleContext }, { commitModuleSource, readModuleMaterial }, { ensureVersionMaterial }, { moduleMaterialDigest }, { ModuleDirectory }, { testDb }, { testModuleProcess }] = await Promise.all([
  import("./module-context"), import("./module-git"), import("./module-source"), import("./module-artifacts"), import("./module-files"), import("../__testing__/test-db"), import("../__testing__/module-test-process"),
]);
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
afterAll(async () => { await rm(databaseRoot, { recursive: true, force: true }); });

async function fixture(python = false) {
  const root = await mkdtemp(join(tmpdir(), "chrona-source-recovery-")), db = testDb();
  cleanups.push(async () => { await db.$disconnect(); await rm(root, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "recovery" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "fixture" } });
  const manifest = { name: "fixture", entry: python ? { path: "index.py", runtime: "python3", args: [] } : "index.ts", packages: ["git"], tests: ["test.ts"], uses: [], effects: [], keepAlive: true };
  const binary = Buffer.from("#!/bin/sh\nexit 0\n");
  const inputs = python ? { "index.py": "import recovered\n", "pyproject.toml": "[project]\nname = 'fixture'\nversion = '1.0.0'\n", "uv.lock": "version = 1\n" } : {
    "index.ts": "import { value } from 'recovered'; if (value !== 42) throw new Error('dependency missing');\n",
    "package.json": JSON.stringify({ dependencies: { recovered: "1.0.0" } }), "bun.lock": "frozen lock bytes",
  };
  const source = { "module.json": JSON.stringify(manifest), "test.ts": "export {};", ...inputs };
  const record = { schema: 1, source: Object.keys(source), artifacts: [{ path: "bin/program", sha256: createHash("sha256").update(binary).digest("hex"), executable: true }], build: { commands: ["exit 99"], toolchain: "offline fixture", target: "fixture" } };
  const files = [...Object.entries(source).map(([path, text]) => ({ path, bytes: Buffer.from(text) })), { path: "chrona-material.json", bytes: Buffer.from(JSON.stringify(record)) }, { path: "bin/program", bytes: binary, executable: true }];
  const calls: string[] = [];
  const packages: NonNullable<StewardPorts["packages"]> = { install: async input => {
    calls.push(input.dir);
    expect(input.packages).toEqual(python ? ["git", "python3"] : ["git"]);
    const dependency = join(input.dir, python ? ".venv" : "node_modules", "recovered");
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, "index.js"), "export const value = 42;");
    if (!python) await writeFile(join(dependency, "package.json"), JSON.stringify({ name: "recovered", main: "index.js", type: "module" }));
    expect(await readFile(join(input.dir, python ? "uv.lock" : "bun.lock"), "utf8")).toBe(inputs[python ? "uv.lock" : "bun.lock"]!);
    return { errors: [], installed: { npm: !python, python, packages: { git: ["test"], ...(python ? { python3: ["test"] } : {}) } } };
  } };
  const ports = { db, dataDir: root, publicUrl: null, now: () => new Date(), packages };
  const context = moduleContext(ports, workspace.id);
  const revision = await commitModuleSource({ platform: context.platform, moduleId: module.id, versionId: "recovery", files, message: "recovery" });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: revision.commit, manifest, source: "user", status: "approved", intent: {}, report: { tests: [], git: revision } } });
  await mkdir(context.store, { recursive: true });
  const final = join(context.store, version.hash);
  const immutable = async () => expect(moduleMaterialDigest(await readModuleMaterial({ platform: context.platform, moduleId: module.id, commit: revision.commit }))).toBe(moduleMaterialDigest(files));
  return { root, db, workspace, module, context, ports, packages, version, final, files, binary, calls, immutable };
}

test.each([false, true])("ordinary restart installs dependencies before launching missing material (python=%s)", async python => {
  const f = await fixture(python);
  await import("./module-effects");
  const { createModuleSupervisor } = await import("./module-supervisor");
  let launched = false;
  const peer = testModuleProcess(async () => ({}));
  const startModule: NonNullable<NonNullable<StewardPorts["sandbox"]>["startModule"]> = input => {
    expect(f.calls).toHaveLength(1);
    expect(readFileSync(join(input.codeDir, python ? ".venv" : "node_modules", "recovered/index.js"), "utf8")).toContain("42");
    if (!python) {
      const child = Bun.spawnSync([process.execPath, "--no-install", "index.ts"], { cwd: input.codeDir, stdout: "pipe", stderr: "pipe" });
      expect(child.stderr.toString()).toBe("");
      expect(child.exitCode).toBe(0);
    }
    launched = true;
    return peer.startModule(input);
  };
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: f.version.hash } });
  const supervisor = createModuleSupervisor({ ...f.ports, sandbox: { available: true, isolated: false, startModule } });
  cleanups.push(() => supervisor.stop());
  await supervisor.reconcile();
  expect(launched).toBe(true);
  expect(f.calls[0]).not.toBe(f.final);
  expect((await stat(f.final)).mode & 0o777).toBe(0o700);
  expect((await stat(join(f.final, "bin/program"))).mode & 0o777).toBe(0o555);
  expect((await stat(join(f.final, "module.json"))).mode & 0o777).toBe(0o444);
  await f.immutable();
});

test("checkout failure leaves no partial final and retry restores complete material", async () => {
  const f = await fixture(), original = ModuleDirectory.prototype.write;
  let writes = 0;
  const write = spyOn(ModuleDirectory.prototype, "write").mockImplementation(async function (this: InstanceType<typeof ModuleDirectory>, file, mode) {
    if (++writes === 3) throw new Error("interrupted checkout");
    return original.call(this, file, mode);
  });
  try { await expect(ensureVersionMaterial(f.context, f.version)).rejects.toThrow("interrupted checkout"); }
  finally { write.mockRestore(); }
  await expect(lstat(f.final)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.context.store)).toEqual([]);
  await f.immutable();
  await ensureVersionMaterial(f.context, f.version);
  expect(await readFile(join(f.final, "bin/program"))).toEqual(f.binary);
  expect(await readdir(f.context.store)).toEqual([f.version.hash]);
});

test.each(["throw", "errors", "bytes", "extra", "mode", "unavailable"] as const)("failed dependency restoration is unpublished and retryable (%s)", async failure => {
  const f = await fixture(), install = f.packages.install;
  if (failure === "unavailable") f.context.ports.packages = undefined;
  else f.packages.install = async input => {
    const result = await install(input);
    if (failure === "throw") throw new Error("installer failed");
    if (failure === "errors") return { ...result, errors: ["frozen lock mismatch"] };
    if (failure === "bytes") await writeFile(join(input.dir, "index.ts"), "changed by installer");
    if (failure === "extra") await writeFile(join(input.dir, "helper.js"), "undeclared");
    if (failure === "mode") await chmod(join(input.dir, "index.ts"), 0o755);
    return result;
  };
  await expect(ensureVersionMaterial(f.context, f.version)).rejects.toThrow();
  await expect(lstat(f.final)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.context.store)).toEqual([]);
  await f.immutable();
  f.context.ports.packages = f.packages;
  f.packages.install = install;
  await ensureVersionMaterial(f.context, f.version);
  expect(await readFile(join(f.final, "bin/program"))).toEqual(f.binary);
});

test.each(["valid", "empty", "symlink"] as const)("concurrent recovery verifies and preserves the publication winner (%s)", async winner => {
  const f = await fixture(), install = f.packages.install;
  let enter!: () => void, release!: () => void, first = true;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.packages.install = async input => {
    const result = await install(input);
    if (first) { first = false; enter(); await gate; }
    return result;
  };
  const pending = ensureVersionMaterial(f.context, f.version).then(() => null, error => error);
  try {
    await entered;
    await expect(lstat(f.final)).rejects.toMatchObject({ code: "ENOENT" });
    if (winner === "valid") await ensureVersionMaterial(f.context, f.version);
    else if (winner === "empty") await mkdir(f.final);
    else await symlink(f.root, f.final);
    const before = await lstat(f.final);
    release();
    const error = await pending;
    if (winner === "valid") { expect(error).toBeNull(); expect(await readFile(join(f.final, "bin/program"))).toEqual(f.binary); }
    else { expect(error).not.toBeNull(); if (winner === "empty") expect(await readdir(f.final)).toEqual([]); else expect((await lstat(f.final)).isSymbolicLink()).toBe(true); }
    expect((await lstat(f.final)).ino).toBe(before.ino);
    expect(await readdir(f.context.store)).toEqual([f.version.hash]);
    await f.immutable();
  } finally { release(); await pending; }
});

test.each(["empty", "bytes", "extra", "symlink"] as const)("existing corrupt store fails without repair or installation (%s)", async state => {
  const f = await fixture();
  if (state === "symlink") await symlink(f.root, f.final);
  else if (state === "empty") await mkdir(f.final, { recursive: true });
  else {
    await ensureVersionMaterial(f.context, f.version);
    if (state === "bytes") { await chmod(join(f.final, "bin/program"), 0o755); await writeFile(join(f.final, "bin/program"), "corrupt"); }
    else await writeFile(join(f.final, "extra.js"), "preserve me");
  }
  const count = f.calls.length, before = await lstat(f.final);
  await expect(ensureVersionMaterial(f.context, f.version)).rejects.toThrow();
  expect(f.calls).toHaveLength(count);
  expect((await lstat(f.final)).ino).toBe(before.ino);
  if (state === "empty") expect(await readdir(f.final)).toEqual([]);
  if (state === "bytes") expect(await readFile(join(f.final, "bin/program"), "utf8")).toBe("corrupt");
  if (state === "extra") expect(await readFile(join(f.final, "extra.js"), "utf8")).toBe("preserve me");
  if (state === "symlink") expect((await lstat(f.final)).isSymbolicLink()).toBe(true);
  await f.immutable();
});

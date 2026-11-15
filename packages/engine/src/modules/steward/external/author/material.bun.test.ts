import { expect, test } from "bun:test";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthorError, parseStage, parseValidate } from "./contracts";
import { stagePackage } from "./distribution";
import { createSourceFiles } from "./files";
import { digest, MATERIAL_LIMITS, MATERIAL_RECORD, materialSummary, parseExport, parseImport, parseMaterialRecord, validateMaterial } from "./material";
import { authorTool } from "./workflow";
import { validateWorkspace } from "./validate";

const build = { commands: ["existing compiler --offline", "existing test command"], toolchain: "host tools already installed", target: "host fixture" };
const manifest = JSON.stringify({ name: "fixture", entry: { path: "bin/runtime", args: [] }, tools: [], keepAlive: true, effects: [] });
async function fixture(action: (root: string, files: ReturnType<typeof createSourceFiles>, input: ReturnType<typeof parseImport>, binary: Buffer) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "author-material-"));
  try {
    const content = join(root, "content"), workspace = join(root, "workspace"), data = join(root, "private-data");
    await mkdir(content); await mkdir(workspace); await mkdir(data); await mkdir(join(workspace, "bin"));
    const binary = Buffer.from([0, 255, 128, 1, ...Buffer.alloc(90_000, 127)]);
    await writeFile(join(workspace, "module.json"), manifest);
    await writeFile(join(workspace, ".gitignore"), "bin/\nsecret.txt\n");
    await writeFile(join(workspace, "secret.txt"), "not selected");
    await writeFile(join(workspace, "bin/runtime"), binary); await chmod(join(workspace, "bin/runtime"), 0o751);
    const input = parseImport({ from: workspace, to: "sources/imported", source: ["module.json", ".gitignore"], artifacts: [{ path: "bin/runtime", executable: true }], build });
    await action(root, createSourceFiles(content, [data]), input, binary);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("source and binary record round-trips through import, atomic stage and complete export", async () => fixture(async (root, files, input, binary) => {
  const imported = await files.import(input);
  expect(imported).toMatchObject({ path: "sources/imported", record: "sources/imported/chrona-material.json", files: 4 });
  const source = join(root, "content/sources/imported");
  const record = parseMaterialRecord(await readFile(join(source, MATERIAL_RECORD)));
  expect(record).toEqual({ schema: 1, source: input.source, artifacts: [{ path: "bin/runtime", executable: true, sha256: digest(binary) }], build });
  expect(record.source).not.toContain(MATERIAL_RECORD);
  expect(await readFile(join(source, "bin/runtime"))).toEqual(Buffer.from(binary));
  expect((await lstat(join(source, "bin/runtime"))).mode & 0o777).toBe(0o700);
  expect((await lstat(join(source, ".gitignore"))).mode & 0o777).toBe(0o600);
  await expect(lstat(join(source, "secret.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(files.read("sources/imported/bin/runtime")).rejects.toMatchObject({ code: "too_large" });
  const staged = await stagePackage(files, parseStage({ name: "fixture", from: input.to, to: "packages/release", provenance: { kind: "local", label: "generic binary fixture" } }));
  expect(staged.files).toBe(4);
  expect(staged.materialDigest).toBe(imported.materialDigest);
  const exported = await files.export(staged.dir, join(root, "exported"));
  expect(exported.materialDigest).toBe(imported.materialDigest);
  expect(await readFile(join(root, "exported/bin/runtime"))).toEqual(Buffer.from(binary));
  expect((await lstat(join(root, "exported/bin/runtime"))).mode & 0o777).toBe(0o700);
  expect(await readFile(join(root, "exported", MATERIAL_RECORD))).toEqual(await readFile(join(source, MATERIAL_RECORD)));
  await files.export(input.to, join(root, "baseline"));
  expect(await readFile(join(root, "baseline/bin/runtime"))).toEqual(Buffer.from(binary));
  expect((await readdir(join(root, "content/packages"))).sort()).toEqual(["release"]);
}));

test("imports and exports never replace existing files, empty directories, symlinks or snapshots", async () => fixture(async (root, files, input) => {
  await files.import(input);
  await expect(files.import(input)).rejects.toMatchObject({ code: "conflict" });
  const destinations = ["empty", "occupied", "alias", "file"];
  await mkdir(join(root, "empty")); await mkdir(join(root, "occupied"));
  await writeFile(join(root, "occupied/keep"), "keep"); await writeFile(join(root, "file"), "keep");
  await symlink(join(root, "occupied"), join(root, "alias"));
  for (const path of destinations) await expect(files.export(input.to, join(root, path))).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(root, "occupied/keep"), "utf8")).toBe("keep");
  expect(await readFile(join(root, "file"), "utf8")).toBe("keep");
  expect(await readdir(join(root, "empty"))).toEqual([]);
  expect((await readdir(root)).some(name => name.startsWith(".author-material-"))).toBe(false);
  expect(await readdir(join(root, "content/sources"))).toEqual(["imported"]);
}));

test("explicit selection rejects identity claims, digests, overlap, hidden storage and excessive counts", async () => fixture(async (root, files, input) => {
  for (const extra of [{ principal: "owner" }, { runId: "fake" }, { cwd: input.from }]) expect(() => parseImport({ ...input, ...extra })).toThrow(AuthorError);
  for (const patch of [
    { source: ["module.json", MATERIAL_RECORD] }, { source: ["module.json", "module.json"] },
    { artifacts: [{ path: "module.json" }] }, { artifacts: [{ path: "module.json/x" }] },
    { artifacts: [{ path: "bin" }, { path: "bin/runtime" }] },
    { artifacts: [{ path: "a" }, { path: "a-b" }, { path: "a/x" }] },
    { artifacts: Array.from({ length: 400 }, (_, i) => ({ path: `f${i}/a/b/c/d/e/f/g/h/i/runtime` })) },
    { artifacts: [{ path: "bin/runtime", sha256: "a".repeat(64) }] },
    { artifacts: [{ path: "bin/runtime", executable: "yes" }] },
    { source: [".gitignore"] }, { source: ["module.json", ".venv/config"] },
    { source: ["module.json", ".git/config"] }, { source: ["module.json", "node_modules/a"] },
    { source: ["module.json", "../private-data/a"] },
    { artifacts: Array.from({ length: 1001 }, (_, i) => ({ path: `bin/f${i}` })) },
    { from: "relative/path" }, { from: input.from + "/../workspace" },
  ]) expect(() => parseImport({ ...input, ...patch })).toThrow(AuthorError);
  expect(() => parseExport({ path: input.to, to: join(root, "out"), principal: "owner" })).toThrow(AuthorError);
  expect(() => parseExport({ path: "packages/stage/provenance.json", to: join(root, "out") })).toThrow(AuthorError);
  for (const privatePath of [join(root, "content"), join(root, "content/sources/else"), join(root, "private-data"), root]) {
    await expect(files.import({ ...input, from: privatePath })).rejects.toThrow(/private application storage/);
    await expect(files.export(input.to, privatePath)).rejects.toThrow(/private application storage/);
  }
  // Providers cannot gain host I/O through the new owner tools.
  const context = { files, async call() { throw new Error("no kernel calls"); } };
  for (const id of ["import", "export"]) for (const caller of [undefined, { kind: "provider" }]) await expect(authorTool(context, id, {}, caller)).rejects.toMatchObject({ code: "forbidden" });
}));

test("selected symlinks, hardlinks, special files and symlinked parents or roots fail closed", async () => fixture(async (root, files, input) => {
  const workspace = input.from, runtime = join(workspace, "bin/runtime"), outside = join(root, "outside");
  await writeFile(outside, "unchanged");
  await rename(runtime, runtime + ".original");
  await symlink(outside, runtime);
  await expect(files.import(input)).rejects.toBeInstanceOf(AuthorError);
  await rm(runtime); await link(outside, runtime);
  await expect(files.import(input)).rejects.toMatchObject({ code: "unsafe_source" });
  await rm(runtime);
  // A FIFO must not block: O_NONBLOCK + regular-file validation rejects it.
  const fifo = Bun.spawnSync(["mkfifo", runtime]); expect(fifo.exitCode).toBe(0);
  await expect(files.import(input)).rejects.toMatchObject({ code: "unsafe_source" });
  await rm(runtime); await rename(runtime + ".original", runtime);
  await rename(join(workspace, "bin"), join(workspace, "real-bin"));
  await symlink(join(workspace, "real-bin"), join(workspace, "bin"));
  await expect(files.import(input)).rejects.toBeInstanceOf(AuthorError);
  await symlink(workspace, join(root, "workspace-alias"));
  await expect(files.import({ ...input, from: join(root, "workspace-alias") })).rejects.toMatchObject({ code: "unsafe_source" });
  expect(await readFile(outside, "utf8")).toBe("unchanged");
  expect((await readdir(join(root, "content"))).filter(name => name !== "sources")).toEqual([]);
}));

test("artifact digest, mode, membership and source limits are revalidated before export or staging", async () => fixture(async (root, files, input, binary) => {
  await files.import(input);
  const source = join(root, "content/sources/imported"), artifact = join(source, "bin/runtime");
  await writeFile(artifact, "changed");
  await expect(files.export(input.to, join(root, "out"))).rejects.toMatchObject({ code: "conflict" });
  await writeFile(artifact, binary); await chmod(artifact, 0o600);
  await expect(files.snapshot(input.to)).rejects.toMatchObject({ code: "conflict" });
  await chmod(artifact, 0o700); await writeFile(join(source, "extra"), "unselected");
  await expect(files.snapshot(input.to)).rejects.toThrow(/outside its record/);
  await rm(join(source, "extra")); await rm(artifact);
  await expect(files.snapshot(input.to)).rejects.toThrow(/missing files/);
  await writeFile(artifact, binary); await chmod(artifact, 0o700);
  await writeFile(join(input.from, "module.json"), Buffer.alloc(1024 * 1024 + 1));
  await expect(files.import({ ...input, to: "sources/oversized" })).rejects.toMatchObject({ code: "too_large" });
  await expect(lstat(join(root, "content/sources/oversized"))).rejects.toMatchObject({ code: "ENOENT" });
  const invalidRecord = Buffer.from(JSON.stringify({ schema: 1, source: ["module.json"], artifacts: [{ path: "bin/runtime", sha256: "a".repeat(64) }], build }));
  expect(() => validateMaterial([{ path: "module.json", bytes: Buffer.from(manifest) }, { path: MATERIAL_RECORD, bytes: invalidRecord }])).toThrow(/missing files/);
}));

test("64 MiB binary limit is supported, larger sparse files fail without publication", async () => fixture(async (root, files, input) => {
  const runtime = join(input.from, "bin/runtime");
  await truncate(runtime, MATERIAL_LIMITS.fileBytes);
  await files.import(input);
  expect((await lstat(join(root, "content/sources/imported/bin/runtime"))).size).toBe(MATERIAL_LIMITS.fileBytes);
  await truncate(runtime, MATERIAL_LIMITS.fileBytes + 1);
  await expect(files.import({ ...input, to: "sources/too-big" })).rejects.toMatchObject({ code: "too_large" });
  expect(await readdir(join(root, "content/sources"))).toEqual(["imported"]);
}));

test("changing a selected inode during a read is detected and publishes no snapshot", async () => fixture(async (root, files, input) => {
  const target = join(input.from, "bin/runtime");
  const probe = await open(target, "r"), prototype = Object.getPrototypeOf(probe);
  const original = prototype.read;
  await probe.close();
  let changed = false;
  prototype.read = async function (...args: unknown[]) {
    const result = await original.apply(this, args);
    if (!changed && await realpath(`/proc/self/fd/${this.fd}`) === target) {
      changed = true;
      await chmod(target, 0o600);
    }
    return result;
  };
  try { await expect(files.import(input)).rejects.toMatchObject({ code: "conflict" }); }
  finally { prototype.read = original; }
  expect(changed).toBe(true);
  await expect(lstat(join(root, "content/sources/imported"))).rejects.toMatchObject({ code: "ENOENT" });
}));

test("replacing a workspace parent during a read fails before publication", async () => fixture(async (root, files, input) => {
  const target = join(input.from, "bin/runtime");
  const probe = await open(target, "r"), prototype = Object.getPrototypeOf(probe), original = prototype.read;
  await probe.close();
  let changed = false;
  prototype.read = async function (...args: unknown[]) {
    const result = await original.apply(this, args);
    if (!changed && await realpath(`/proc/self/fd/${this.fd}`) === target) {
      changed = true;
      await rename(input.from, join(root, "moved-workspace")); await mkdir(input.from);
    }
    return result;
  };
  try { await expect(files.import(input)).rejects.toMatchObject({ code: "conflict" }); }
  finally { prototype.read = original; }
  expect(changed).toBe(true);
  await expect(lstat(join(root, "content/sources/imported"))).rejects.toMatchObject({ code: "ENOENT" });
}));

test("aggregate material and selection counts include the automatic record", () => {
  const small = Buffer.alloc(0), sha256 = digest(small);
  const source = [{ path: "module.json", bytes: Buffer.from(manifest) }, ...Array.from({ length: 198 }, (_, i) => ({ path: `source-${i}`, bytes: small }))];
  const artifacts = Array.from({ length: 1000 }, (_, i) => ({ path: `bin/f${i}`, sha256 }));
  const record = { schema: 1, source: source.map(file => file.path), artifacts, build };
  const material = [...source, ...artifacts.map(file => ({ path: file.path, bytes: small })), { path: MATERIAL_RECORD, bytes: Buffer.from(JSON.stringify(record)) }];
  expect(material).toHaveLength(1200);
  expect(validateMaterial(material).record?.artifacts).toHaveLength(1000);
  expect(() => validateMaterial([...material, { path: "extra", bytes: small }])).toThrow(/file count limit/);
  const large = Buffer.alloc(MATERIAL_LIMITS.fileBytes);
  const outputs = Array.from({ length: 5 }, (_, i) => ({ path: `bin/f${i}`, sha256: digest(large) }));
  const full = [...source, ...outputs.map(file => ({ path: file.path, bytes: large })), { path: MATERIAL_RECORD, bytes: Buffer.from(JSON.stringify({ ...record, artifacts: outputs })) }];
  expect(() => validateMaterial(full)).toThrow(/byte limits/);
});

test("concurrent publication has exactly one complete winner and cleans only its own temps", async () => fixture(async (root, files, input, binary) => {
  const settled = await Promise.allSettled([files.import(input), files.import(input)]);
  expect(settled.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(settled.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(await readFile(join(root, "content/sources/imported/bin/runtime"))).toEqual(Buffer.from(binary));
  expect(await readdir(join(root, "content/sources"))).toEqual(["imported"]);
  // Existing unrelated temp-looking directories are never reclaimed.
  await mkdir(join(root, ".author-material-keep")); await writeFile(join(root, ".author-material-keep/keep"), "keep");
  await files.export(input.to, join(root, "export"));
  await expect(files.export(input.to, join(root, "export"))).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(root, ".author-material-keep/keep"), "utf8")).toBe("keep");
}));

test("material transport preserves hidden build configuration and sources larger than text-edit limits", async () => fixture(async (root, files, input) => {
  await mkdir(join(input.from, ".cargo"));
  await writeFile(join(input.from, ".cargo/config.toml"), "[build]\noffline=true\n");
  const source = Buffer.alloc(70 * 1024, 97);
  await writeFile(join(input.from, "source.rs"), source);
  const selected = parseImport({ ...input, source: [...input.source, ".cargo/config.toml", "source.rs"] });
  await files.import(selected);
  const staged = await stagePackage(files, parseStage({ name: "fixture", from: selected.to, to: "packages/large-source", provenance: { kind: "local", label: "source transport" } }));
  await files.export(staged.dir, join(root, "large-export"));
  expect(await readFile(join(root, "large-export/.cargo/config.toml"), "utf8")).toContain("offline=true");
  expect(await readFile(join(root, "large-export/source.rs"))).toEqual(source);
}));

test("source budget reserves the material record before any import is published", async () => fixture(async (root, files, input) => {
  expect(() => parseImport({ ...input, source: ["module.json", ...Array.from({ length: 199 }, (_, index) => `source-${index}`)] })).toThrow(AuthorError);
  const manifestBytes = await readFile(join(input.from, "module.json"));
  await writeFile(join(input.from, "large-source"), Buffer.alloc(1024 * 1024 - manifestBytes.length, 97));
  const selected = parseImport({ ...input, source: ["module.json", "large-source"], artifacts: [] });
  await expect(files.import(selected)).rejects.toMatchObject({ code: "too_large" });
  await expect(lstat(join(root, "content/sources/imported"))).rejects.toMatchObject({ code: "ENOENT" });
}));

test("overwrite imports stage a clean replacement and preserve the old tree on invalid input", async () => fixture(async (root, files, input) => {
  await files.import(input);
  await files.write(`${input.to}/stale.txt`, "stale");
  const replacement = parseImport({ ...input, overwrite: true });
  await files.import(replacement);
  await expect(lstat(join(root, "content", input.to, "stale.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(join(root, "content/sources"))).toEqual(["imported"]);
  const before = await readFile(join(root, "content", input.to, "module.json"));
  await rm(join(input.from, "module.json"));
  await expect(files.import(replacement)).rejects.toBeInstanceOf(AuthorError);
  expect(await readFile(join(root, "content", input.to, "module.json"))).toEqual(before);
}));

test("overwrite exports replace an existing directory completely and reject aliases or private storage", async () => fixture(async (root, files, input, binary) => {
  await files.import(input);
  const to = join(root, "exported");
  await mkdir(to); await writeFile(join(to, "stale.txt"), "stale");
  const parsed = parseExport({ path: input.to, to, overwrite: true });
  await files.export(parsed.path, parsed.to, parsed.overwrite);
  await expect(lstat(join(to, "stale.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(to, "bin/runtime"))).toEqual(Buffer.from(binary));
  await symlink(to, join(root, "alias"));
  await expect(files.export(input.to, join(root, "alias"), true)).rejects.toMatchObject({ code: "unsafe_source" });
  await expect(files.export(input.to, join(root, "content/sources/other"), true)).rejects.toThrow(/private application storage/);
  await expect(files.import({ ...input, to: "../escape", overwrite: true })).rejects.toBeInstanceOf(AuthorError);
  await rm(join(root, "content", input.to), { recursive: true });
  await symlink(to, join(root, "content", input.to));
  await expect(files.import({ ...input, overwrite: true })).rejects.toMatchObject({ code: "unsafe_source" });
  expect(await readFile(join(to, "bin/runtime"))).toEqual(Buffer.from(binary));
}));

test("overwrite and validation contracts reject non-boolean flags and invalid paths", async () => fixture(async (root, _files, input) => {
  for (const overwrite of [null, "true", 1]) {
    expect(() => parseImport({ ...input, overwrite })).toThrow(AuthorError);
    expect(() => parseExport({ path: input.to, to: join(root, "out"), overwrite })).toThrow(AuthorError);
  }
  expect(parseValidate({ path: "sources/check", runTests: false })).toEqual({ path: "sources/check", runTests: false });
  expect(parseValidate({ path: "packages/check/source" })).toEqual({ path: "packages/check/source" });
  for (const input of [{ path: "packages/check/provenance.json" }, { path: "sources/check", runTests: "yes" }, { path: "sources/check", extra: true }]) expect(() => parseValidate(input)).toThrow(AuthorError);
}));

async function validationFixture(action: (files: ReturnType<typeof createSourceFiles>, path: string, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "author-validate-"));
  try {
    const files = createSourceFiles(root), path = "sources/check";
    await files.write(`${path}/module.json`, JSON.stringify({ name: "fixture", entry: "index.ts", tools: [{ name: "check", description: "Check fixture", parameters: { type: "object" }, output: {} }], effects: [] }));
    await files.write(`${path}/index.ts`, "export {};\n");
    await action(files, path, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("validateWorkspace passes a valid module and discovers a passing local test", async () => validationFixture(async (files, path, root) => {
  expect(await files.workspacePath(path)).toBe(join(root, path));
  expect(await validateWorkspace(files, { path })).toMatchObject({ ok: true, path, tests: { ran: false } });
  await files.write(`${path}/pass.bun.test.ts`, 'import { test, expect } from "bun:test"; test("local pass", () => expect(1).toBe(1));');
  expect(await validateWorkspace(files, { path })).toMatchObject({ ok: true, tests: { ran: true, ok: true, exitCode: 0 } });
}));

test("validateWorkspace requires bun.lock for every package.json", async () => validationFixture(async (files, path) => {
  for (const key of ["dependencies", "devDependencies"]) {
    await files.write(`${path}/package.json`, JSON.stringify({ [key]: { fixture: "1.0.0" } }));
    const result = await validateWorkspace(files, { path });
    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual({ name: "dependencies", ok: false, detail: "package.json requires bun.lock in the workspace (including empty packages)." });
  }
  await files.write(`${path}/bun.lock`, "{}\n");
  expect((await validateWorkspace(files, { path })).ok).toBe(true);
}));

test("validateWorkspace rejects malformed manifests, missing entries and duplicate tool/page identifiers", async () => validationFixture(async (files, path) => {
  for (const manifest of ["{", "[]", JSON.stringify({ name: "BAD", entry: "index.ts" }), JSON.stringify({ name: "fixture", entry: "../index.ts" }), JSON.stringify({ name: "fixture", entry: "missing.ts" }), JSON.stringify({ name: "fixture", entry: "index.ts", tools: [{ name: "same", parameters: {} }, { name: "same", parameters: {} }] }), JSON.stringify({ name: "fixture", entry: "index.ts", tools: [{ name: "bad", parameters: [] }] }), JSON.stringify({ name: "fixture", entry: "index.ts", pages: [{ id: "same" }, { id: "same" }] }), JSON.stringify({ name: "fixture", entry: "index.ts", pages: [{ id: "home", layout: "invalid" }] })]) {
    await files.write(`${path}/module.json`, manifest);
    const result = await validateWorkspace(files, { path });
    expect(result.ok).toBe(false);
    expect(result.checks.some(check => check.name === "module.json" && !check.ok)).toBe(true);
  }
}));

test("validateWorkspace reports failing test output and supports explicitly skipping tests", async () => validationFixture(async (files, path) => {
  await files.write(`${path}/fail.test.ts`, 'import { test, expect } from "bun:test"; test("local failure", () => { console.log("x".repeat(20000)); expect(1).toBe(2); });');
  const result = await validateWorkspace(files, { path });
  expect(result.ok).toBe(false);
  expect(result.tests).toMatchObject({ ran: true, ok: false });
  expect(result.tests!.exitCode).not.toBe(0);
  expect(Buffer.byteLength(result.tests!.output)).toBeLessThanOrEqual(8192);
  expect(result.tests!.output.length).toBeGreaterThan(0);
  expect(await validateWorkspace(files, { path, runTests: false })).toMatchObject({ ok: true, tests: { ran: false } });
}));

test("validateWorkspace rejects symlinks, special files, oversized trees and missing workspaces", async () => validationFixture(async (files, path, root) => {
  const target = join(root, path, "unsafe");
  await symlink(join(root, path, "index.ts"), target);
  expect((await validateWorkspace(files, { path })).ok).toBe(false);
  await rm(target);
  expect(Bun.spawnSync(["mkfifo", target]).exitCode).toBe(0);
  expect((await validateWorkspace(files, { path })).ok).toBe(false);
  await rm(target);
  await writeFile(target, Buffer.alloc(64 * 1024 + 1));
  expect((await validateWorkspace(files, { path })).ok).toBe(false);
  expect((await validateWorkspace(files, { path: "sources/missing" })).ok).toBe(false);
}));


test("validateWorkspace rejects obsolete run paths, supports recorded native entries and reports missing manifests", async () => {
  await validationFixture(async (files, path, root) => {
    await files.write(`${path}/module.json`, JSON.stringify({ name: "fixture", run: "index.ts" }));
    expect((await validateWorkspace(files, { path })).ok).toBe(false);
    await rm(join(root, path, "module.json"));
    expect((await validateWorkspace(files, { path })).checks).toContainEqual({ name: "module.json", ok: false, detail: "Missing module.json." });
  });
  await fixture(async (_root, files, input) => {
    await files.import(input);
    expect((await validateWorkspace(files, { path: input.to })).ok).toBe(true);
  });
});

test("no-test materials stay locally usable with truthful skipped test results", async () => validationFixture(async (files, path) => {
  expect(await validateWorkspace(files, { path })).toMatchObject({ ok: true, tests: { ran: false, ok: null, exitCode: null, reason: "no_tests" } });
  expect(await validateWorkspace(files, { path, runTests: false })).toMatchObject({ ok: true, tests: { ran: false, ok: null, exitCode: null, reason: "not_requested" } });
  await files.write(`${path}/module.json`, "{}");
  expect(await validateWorkspace(files, { path })).toMatchObject({ ok: false, tests: { ran: false, ok: null, exitCode: null, reason: "checks_failed" } });
  expect(await validateWorkspace(files, { path: "sources/missing" })).toMatchObject({ ok: false, tests: { ran: false, ok: null, exitCode: null, reason: "checks_failed" } });
}));

test("declared standalone test.ts and shell scripts execute alongside JavaScript Bun suites", async () => validationFixture(async (files, path) => {
  const manifest = JSON.parse((await files.read(`${path}/module.json`)).content);
  manifest.tests = ["test.ts", "check.sh"];
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  await files.write(`${path}/test.ts`, 'console.log("DECLARED_TS");');
  await files.write(`${path}/check.sh`, 'echo DECLARED_SH\n');
  await files.write(`${path}/action.spec.js`, 'import { test } from "bun:test"; test("suite", () => console.log("BUN_SUITE"));');
  const result = await validateWorkspace(files, { path });
  expect(result).toMatchObject({ ok: true, tests: { ran: true, ok: true, exitCode: 0, reason: null } });
  for (const marker of ["DECLARED_TS", "DECLARED_SH", "BUN_SUITE"]) expect(result.tests.output).toContain(marker);
  await files.write(`${path}/test.ts`, 'console.log("declared failure"); process.exit(7);');
  expect(await validateWorkspace(files, { path })).toMatchObject({ ok: false, tests: { ran: true, ok: false, exitCode: 7, reason: "failed" } });
  manifest.tests = ["missing.ts"];
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  expect(await validateWorkspace(files, { path })).toMatchObject({ ok: false, tests: { ran: false, reason: "checks_failed" } });
}));

test("stage reuses exact-snapshot checks, leaves invalid material unstaged and never runs tests", async () => validationFixture(async (files, path, root) => {
  const input = parseStage({ name: "fixture", from: path, to: "packages/checked", provenance: { kind: "local", label: "local checks" } });
  const original = (await files.read(`${path}/module.json`)).content;
  await files.write(`${path}/package.json`, "{}");
  await expect(stagePackage(files, input)).rejects.toThrow("bun.lock");
  await expect(lstat(join(root, input.to))).rejects.toMatchObject({ code: "ENOENT" });
  await files.write(`${path}/bun.lock`, "{}\n");
  const manifest = JSON.parse(original);
  delete manifest.tools[0].output;
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  await expect(stagePackage(files, input)).rejects.toThrow("output schema");
  await expect(lstat(join(root, input.to))).rejects.toMatchObject({ code: "ENOENT" });
  await files.write(`${path}/module.json`, original);
  await files.write(`${path}/fail.test.ts`, 'throw new Error("tests only run when requested");');
  const staged = await stagePackage(files, input);
  const checked = await validateWorkspace(files, { path: staged.dir, runTests: false });
  expect(staged.checks.every(check => check.ok)).toBe(true);
  expect(checked.checks.filter(check => check.name !== "workspace")).toEqual(staged.checks);
  expect(checked.tests).toMatchObject({ ran: false, ok: null, reason: "not_requested" });
  await files.write(`${path}/module.json`, "{}");
  expect((await validateWorkspace(files, { path: staged.dir, runTests: false })).ok).toBe(true);
  expect(await validateWorkspace(files, { path: staged.dir })).toMatchObject({ ok: false, tests: { ran: true, ok: false } });
}));

test("snapshot tests retain selected imports without rewriting recorded source or stage digests", async () => fixture(async (root, files, input) => {
  const workspace = input.from;
  const module = JSON.parse(await readFile(join(workspace, "module.json"), "utf8"));
  module.tests = ["test.ts"];
  await writeFile(join(workspace, "module.json"), JSON.stringify(module));
  await mkdir(join(workspace, "lib"));
  await writeFile(join(workspace, "lib/helper.ts"), "export const value = 42;\n");
  await writeFile(join(workspace, "test.ts"), [
    'import { value } from "./lib/helper.ts";',
    'if (value !== 42) throw new Error("selected import failed");',
    'await Bun.write("module.json", "{}"); await Bun.write("test-output", "temporary");',
    'console.log("SNAPSHOT_IMPORT_PASSED");',
  ].join("\n"));
  const imported = await files.import({ ...input, source: [...input.source, "test.ts", "lib/helper.ts"] });
  const staged = await stagePackage(files, parseStage({ name: "fixture", from: input.to, to: "packages/stable", provenance: { kind: "local", label: "snapshot checks" } }));
  const metadata = (await files.read(staged.metadata)).content;
  for (const path of [input.to, staged.dir]) {
    const result = await validateWorkspace(files, { path });
    expect(result).toMatchObject({ ok: true, tests: { ran: true, ok: true } });
    expect(result.tests.output).toContain("SNAPSHOT_IMPORT_PASSED");
    expect(materialSummary(await files.snapshot(path)).materialDigest).toBe(imported.materialDigest);
    await expect(files.read(`${path}/test-output`)).rejects.toMatchObject({ code: "not_found" });
  }
  expect((await files.read(staged.metadata)).content).toBe(metadata);
  const exported = await files.export(staged.dir, join(root, "exported-after-tests"));
  expect(exported.materialDigest).toBe(staged.materialDigest);
}));

test("local manifest checks catch common kernel entry/tool/lock mismatches", async () => validationFixture(async (files, path) => {
  const original = JSON.parse((await files.read(`${path}/module.json`)).content);
  const patches = [
    { entry: "lib/index.ts" }, { entry: { path: "index.ts" } }, { entry: { path: "index.ts", runtime: "bun --no-install" } },
    { entry: { path: "index.ts", runtime: "bun", args: [12] } },
    { effects: ["network", "network"] }, { effects: ["filesystem"] }, { name: "modules" }, { pages: [] },
    { tools: [] }, { tools: [{ ...original.tools[0], output: undefined }] },
    { tools: [{ ...original.tools[0], parameters: { type: "object", additionalProperties: false } }] },
    { tools: [{ ...original.tools[0], visibility: ["provider", "provider"] }] },
  ];
  for (const patch of patches) {
    await files.write(`${path}/module.json`, JSON.stringify({ ...original, ...patch }));
    expect((await validateWorkspace(files, { path, runTests: false })).ok, JSON.stringify(patch)).toBe(false);
  }
  await files.write(`${path}/module.json`, JSON.stringify({ ...original, entry: { path: "index.ts", runtime: "bun", args: ["--no-install"] }, tests: [] }));
  expect((await validateWorkspace(files, { path })).ok).toBe(true);
  await files.write(`${path}/pyproject.toml`, "[project]\nname = 'fixture'\n");
  expect((await validateWorkspace(files, { path })).checks).toContainEqual({ name: "dependencies", ok: false, detail: "pyproject.toml requires uv.lock in the workspace." });
  await files.write(`${path}/uv.lock`, "version = 1\n");
  expect((await validateWorkspace(files, { path })).ok).toBe(true);
}));

test("declared suite-like filenames retain standalone execution order", async () => validationFixture(async (files, path) => {
  const manifest = JSON.parse((await files.read(`${path}/module.json`)).content);
  manifest.tests = ["setup_test.ts", "verify.ts"];
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  await files.write(`${path}/setup_test.ts`, 'await Bun.write("setup-marker", "ready"); console.log("SETUP_ONCE");');
  await files.write(`${path}/verify.ts`, 'if (await Bun.file("setup-marker").text() !== "ready") process.exit(1); console.log("VERIFIED_AFTER_SETUP");');
  const result = await validateWorkspace(files, { path });
  expect(result).toMatchObject({ ok: true, tests: { ran: true, ok: true } });
  expect(result.tests.output.indexOf("SETUP_ONCE")).toBeLessThan(result.tests.output.indexOf("VERIFIED_AFTER_SETUP"));
  expect(result.tests.output.match(/SETUP_ONCE/g)).toHaveLength(1);
}));

test("later runner startup failures preserve evidence that an earlier script ran", async () => validationFixture(async (files, path) => {
  const manifest = JSON.parse((await files.read(`${path}/module.json`)).content);
  manifest.tests = ["test.ts", "next.sh"];
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  await files.write(`${path}/test.ts`, 'import { rm } from "node:fs/promises"; console.log("FIRST_SCRIPT_RAN"); await rm(process.cwd(), { recursive: true });');
  await files.write(`${path}/next.sh`, 'echo should-not-start\n');
  const result = await validateWorkspace(files, { path });
  expect(result).toMatchObject({ ok: false, tests: { ran: true, ok: false, exitCode: null, reason: "runner_error" } });
  expect(result.tests.output).toContain("FIRST_SCRIPT_RAN");
}));

test("malformed UTF-8 test output stays within the returned byte limit", async () => validationFixture(async (files, path) => {
  const manifest = JSON.parse((await files.read(`${path}/module.json`)).content);
  manifest.tests = ["test.ts"];
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  await files.write(`${path}/test.ts`, 'process.stdout.write(Buffer.alloc(8192, 255));');
  const result = await validateWorkspace(files, { path });
  expect(result).toMatchObject({ ok: true, tests: { ran: true, ok: true } });
  expect(Buffer.byteLength(result.tests.output)).toBeLessThanOrEqual(8192);
  expect(result.tests.output.length).toBeGreaterThan(0);
}));

test("local timeout bounds shell descendants holding output pipes", async () => validationFixture(async (files, path) => {
  const manifest = JSON.parse((await files.read(`${path}/module.json`)).content);
  manifest.tests = ["wait.sh"];
  await files.write(`${path}/module.json`, JSON.stringify(manifest));
  await files.write(`${path}/wait.sh`, '"' + process.execPath + '" --no-install -e \'process.stdout.write(Buffer.alloc(8192, 255))\'\nsleep 120\necho should-not-complete\n');
  const started = Date.now();
  const result = await validateWorkspace(files, { path });
  expect(result).toMatchObject({ ok: false, tests: { ran: true, ok: false, reason: "timeout" } });
  expect(result.tests.output).toContain("Test timeout after 30s");
  expect(Buffer.byteLength(result.tests.output)).toBeLessThanOrEqual(8192);
  expect(Date.now() - started).toBeLessThan(35_000);
}), 40_000);

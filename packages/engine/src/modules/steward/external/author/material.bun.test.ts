import { expect, test } from "bun:test";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthorError, parseStage } from "./contracts";
import { stagePackage } from "./distribution";
import { createSourceFiles } from "./files";
import { digest, MATERIAL_LIMITS, MATERIAL_RECORD, parseExport, parseImport, parseMaterialRecord, validateMaterial } from "./material";
import { authorTool } from "./workflow";

const build = { commands: ["existing compiler --offline", "existing test command"], toolchain: "host tools already installed", target: "host fixture" };
const manifest = JSON.stringify({ name: "fixture", entry: { path: "bin/runtime", args: [] }, tools: [] });
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

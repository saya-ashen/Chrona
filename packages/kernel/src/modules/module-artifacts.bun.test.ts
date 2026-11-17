import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES, MODULE_SOURCE_MAX_FILES, MODULE_ARTIFACT_MAX_FILE_BYTES, moduleMaterialSchema } from "../../../contracts/src/steward/module-material";

// Engine imports must never inherit a developer/live database URL.
const databaseRoot = mkdtempSync(join(tmpdir(), "chrona-material-test-db-"));
process.env.DATABASE_URL = `file:${join(databaseRoot, "test.db")}`;
const [{ snapshotModuleMaterial, moduleMaterialDigest, moduleSourceFiles, storeModuleArtifacts }, { commitModuleSource, importLegacyModuleSource, moduleGitPath, readModuleSource, readModuleMaterial, exportModuleSource }, { snapshotModule, ModuleDirectory }, { admitCandidates, submitCandidates, candidateSource }, { testDb }, { moduleContext }, { buildPending }, { ensureVersionMaterial }, { rollback }, { testModuleProcess }, { createExternalModuleInstaller, installExternal }] = await Promise.all([
  import("./module-artifacts"), import("./module-git"), import("./module-files"), import("./module-candidates"), import("../test-db"), import("./module-context"), import("./module-build"), import("./module-source"), import("./module-activation"), import("./module-test-process"), import("./module-install"),
]);
const roots: string[] = [];
const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of closes.splice(0)) await close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
afterAll(async () => { await rm(databaseRoot, { recursive: true, force: true }); });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "chrona-material-test-")); roots.push(root);
  const dir = join(root, "submitted"); await mkdir(join(dir, "bin"), { recursive: true });
  const binary = Buffer.alloc(2 * 1024 * 1024, 0xa5); binary[0] = 0;
  const manifest = { name: "fixture", entry: "index.ts", tests: ["test.ts"], keepAlive: true, uses: [], effects: [] };
  const record = { schema: 1, source: ["module.json", "index.ts", "test.ts", ".gitignore", "build.sh", "deps.lock"], artifacts: [{ path: "bin/program", sha256: digest(binary), executable: true }], build: { commands: ["cc source.c -o bin/program"], toolchain: "test cc", target: "test-host" } };
  for (const [path, text] of Object.entries({ "module.json": JSON.stringify(manifest), "index.ts": "export {};", "test.ts": "export {};", ".gitignore": "bin/\n", "build.sh": "exit 99\n", "deps.lock": "pinned" })) await writeFile(join(dir, path), text);
  await writeFile(join(dir, "bin/program"), binary); await chmod(join(dir, "bin/program"), 0o755);
  await writeFile(join(dir, MODULE_MATERIAL_FILE), JSON.stringify(record));
  const repository = { platform: join(root, "platform"), moduleId: "fixture" };
  return { root, dir, binary, record, manifest, repository };
}
test("explicit material keeps ignored source inputs in Git and binary bytes outside Git, restoring executable copies", async () => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted");
  expect(files).toHaveLength(8);
  await expect(snapshotModule(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  const revision = await commitModuleSource({ ...f.repository, versionId: "first", files, message: "submit" });
  const source = await readModuleSource({ ...f.repository, commit: revision.commit });
  expect(source.map(file => file.path)).toEqual(moduleSourceFiles(files).map(file => file.path));
  expect(source.some(file => file.path === "bin/program")).toBe(false);
  const blob = join(f.repository.platform, "artifacts/sha256", f.record.artifacts[0]!.sha256, "bytes");
  expect(await readFile(blob)).toEqual(f.binary);
  expect((await stat(blob)).mode & 0o777).toBe(0o444);
  // The mutable submitted output can disappear; immutable restoration does not rebuild it.
  await rm(f.dir, { recursive: true });
  expect(moduleMaterialDigest(await readModuleMaterial({ ...f.repository, commit: revision.commit }))).toBe(moduleMaterialDigest(files));
  await exportModuleSource({ ...f.repository, commit: revision.commit, root: f.root, dir: "checkout" });
  expect(await readFile(join(f.root, "checkout/bin/program"))).toEqual(f.binary);
  expect((await stat(join(f.root, "checkout/bin/program"))).mode & 0o777).toBe(0o755);
  expect((await stat(blob)).nlink).toBe(1);
  await writeFile(join(f.root, "checkout/bin/program"), "edited copy");
  expect(await readFile(blob)).toEqual(f.binary);
});
test("artifact bytes and executable mode bind the receipt and Git version", async () => {
  const f = await fixture(), first = await snapshotModuleMaterial(f.root, "submitted");
  const a = await commitModuleSource({ ...f.repository, versionId: "first", files: first, message: "first" });
  const replacement = Buffer.from([0, 1, 2, 255]);
  await writeFile(join(f.dir, "bin/program"), replacement);
  f.record.artifacts[0]!.sha256 = digest(replacement);
  await writeFile(join(f.dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  const second = await snapshotModuleMaterial(f.root, "submitted");
  const b = await commitModuleSource({ ...f.repository, versionId: "second", files: second, message: "second" });
  expect(b.commit).not.toBe(a.commit); expect(moduleMaterialDigest(second)).not.toBe(moduleMaterialDigest(first));
  expect((await readModuleMaterial({ ...f.repository, commit: a.commit })).find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
  f.record.artifacts[0]!.executable = false; await chmod(join(f.dir, "bin/program"), 0o644);
  await writeFile(join(f.dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  const third = await snapshotModuleMaterial(f.root, "submitted");
  const c = await commitModuleSource({ ...f.repository, versionId: "third", files: third, message: "mode" });
  expect(c.commit).not.toBe(b.commit); expect(moduleMaterialDigest(third)).not.toBe(moduleMaterialDigest(second));
});
test("digest mismatch and mode mismatch fail before persistence", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "bin/program"), "different");
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "conflict" });
  await writeFile(join(f.dir, "bin/program"), f.binary); await chmod(join(f.dir, "bin/program"), 0o644);
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "conflict" });
});
test("unsafe source/artifact symlinks, parents and hardlinks are rejected", async () => {
  const f = await fixture(), binaryPath = join(f.dir, "bin/program");
  await rm(binaryPath); await symlink(join(f.dir, "index.ts"), binaryPath);
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "forbidden" });
  await rm(binaryPath); await link(join(f.dir, "index.ts"), binaryPath);
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "forbidden" });
  await rm(join(f.dir, "bin"), { recursive: true }); await symlink(f.root, join(f.dir, "bin"));
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "forbidden" });
});
test("artifact bounds are separate from the source limit and checked before oversized allocation", async () => {
  const f = await fixture();
  const { truncate } = await import("node:fs/promises");
  await truncate(join(f.dir, "bin/program"), MODULE_ARTIFACT_MAX_FILE_BYTES + 1);
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  await writeFile(join(f.dir, "bin/program"), f.binary);
  await writeFile(join(f.dir, "index.ts"), Buffer.alloc(MODULE_SOURCE_MAX_BYTES));
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
});
test("explicit source at 2 MiB roundtrips through Git and export; one extra byte is rejected", async () => {
  const f = await fixture(), initial = await snapshotModuleMaterial(f.root, "submitted");
  const otherBytes = moduleSourceFiles(initial).filter(file => file.path !== "index.ts").reduce((total, file) => total + file.bytes.byteLength, 0);
  const bytes = Buffer.alloc(MODULE_SOURCE_MAX_BYTES - otherBytes, 0x61);
  expect(bytes.byteLength).toBeGreaterThan(1024 * 1024);
  await writeFile(join(f.dir, "index.ts"), bytes);
  const files = await snapshotModuleMaterial(f.root, "submitted");
  expect(moduleSourceFiles(files).reduce((total, file) => total + file.bytes.byteLength, 0)).toBe(2 * 1024 * 1024);
  const revision = await commitModuleSource({ ...f.repository, versionId: "boundary", files, message: "source budget" });
  expect(await readModuleSource({ ...f.repository, commit: revision.commit })).toEqual(moduleSourceFiles(files));
  await exportModuleSource({ ...f.repository, commit: revision.commit, root: f.root, dir: "exported" });
  expect(moduleMaterialDigest(await snapshotModuleMaterial(f.root, "exported"))).toBe(moduleMaterialDigest(files));
  const oversized = Buffer.concat([bytes, Buffer.from("x")]);
  await writeFile(join(f.dir, "index.ts"), oversized);
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  await expect(commitModuleSource({ ...f.repository, versionId: "oversized", files: files.map(file => file.path === "index.ts" ? { ...file, bytes: oversized } : file), message: "oversized" })).rejects.toMatchObject({ code: "invalid" });
});

test("legacy snapshots and imports share the 2 MiB budget and Git reads reject oversized blobs", async () => {
  const f = await fixture();
  await rm(f.dir, { recursive: true }); await mkdir(f.dir);
  const bytes = Buffer.alloc(MODULE_SOURCE_MAX_BYTES - 2, 0x62);
  await writeFile(join(f.dir, "module.json"), "{}"); await writeFile(join(f.dir, "index.ts"), bytes);
  const files = await snapshotModule(f.root, "submitted");
  expect(files.reduce((total, file) => total + file.bytes.byteLength, 0)).toBe(2 * 1024 * 1024);
  const revision = await importLegacyModuleSource({ ...f.repository, legacyHash: moduleMaterialDigest(files), files });
  expect(await readModuleSource({ ...f.repository, commit: revision.commit })).toEqual(files);
  await exportModuleSource({ ...f.repository, commit: revision.commit, root: f.root, dir: "exported" });
  expect(await snapshotModule(f.root, "exported")).toEqual(files);
  await writeFile(join(f.dir, "index.ts"), Buffer.concat([bytes, Buffer.from("x")]));
  await expect(snapshotModule(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  const oversized = [{ path: "index.ts", bytes: Buffer.alloc(MODULE_SOURCE_MAX_BYTES + 1) }];
  await expect(commitModuleSource({ ...f.repository, versionId: "oversized", files: oversized, message: "oversized" })).rejects.toMatchObject({ code: "invalid" });
  await expect(importLegacyModuleSource({ ...f.repository, legacyHash: moduleMaterialDigest(oversized), files: oversized })).rejects.toMatchObject({ code: "invalid" });
  // External Git objects bypass submission validation and must still hit the source bound.
  const repo = moduleGitPath(f.repository.platform, f.repository.moduleId);
  const blob = execFileSync("git", ["--git-dir", repo, "hash-object", "-w", "--stdin"], { input: oversized[0]!.bytes, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["--git-dir", repo, "mktree"], { input: `100644 blob ${blob}\tindex.ts\n`, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["--git-dir", repo, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit-tree", tree], { input: "oversized", encoding: "utf8" }).trim();
  await expect(readModuleSource({ ...f.repository, commit })).rejects.toMatchObject({ code: "invalid" });
});

test("source file counts remain bounded independently of bytes", async () => {
  const f = await fixture();
  const files = Array.from({ length: MODULE_SOURCE_MAX_FILES + 1 }, (_, index) => ({ path: `file-${index}`, bytes: Buffer.alloc(0) }));
  await expect(commitModuleSource({ ...f.repository, versionId: "too-many", files, message: "too many files" })).rejects.toMatchObject({ code: "invalid" });
  expect(moduleMaterialSchema.safeParse({ ...f.record, source: ["module.json", ...files.slice(0, MODULE_SOURCE_MAX_FILES - 2).map(file => file.path)] }).success).toBe(true);
  expect(moduleMaterialSchema.safeParse({ ...f.record, source: ["module.json", ...files.slice(0, MODULE_SOURCE_MAX_FILES - 1).map(file => file.path)] }).success).toBe(false);
});

test("corrupt or missing immutable objects stop restoration and are preserved", async () => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted");
  const revision = await commitModuleSource({ ...f.repository, versionId: "first", files, message: "first" });
  const blob = join(f.repository.platform, "artifacts/sha256", f.record.artifacts[0]!.sha256, "bytes");
  await chmod(blob, 0o644); await writeFile(blob, "corrupt");
  await expect(readModuleMaterial({ ...f.repository, commit: revision.commit })).rejects.toMatchObject({ code: "conflict" });
  await expect(commitModuleSource({ ...f.repository, versionId: "second", files, message: "retry" })).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(blob, "utf8")).toBe("corrupt");
  await rm(blob);
  await expect(readModuleMaterial({ ...f.repository, commit: revision.commit })).rejects.toMatchObject({ code: "ENOENT" });
  await expect(commitModuleSource({ ...f.repository, versionId: "third", files, message: "partial object" })).rejects.toMatchObject({ code: "ENOENT" });
  expect((await stat(join(blob, ".."))).isDirectory()).toBe(true);
});
test("record paths are disjoint, portable, bounded and include module.json", async () => {
  const f = await fixture();
  for (const source of [["index.ts"], ["module.json", "module.json"], ["module.json", MODULE_MATERIAL_FILE], ["module.json", "bin"], ["module.json", "bin/program"], ["module.json", "../escape"], ["module.json", "node_modules/x"], ["module.json", "C:/x"]]) {
    expect(moduleMaterialSchema.safeParse({ ...f.record, source }).success).toBe(false);
  }
  expect(moduleMaterialSchema.safeParse({ ...f.record, artifacts: Array.from({ length: 1001 }, (_, index) => ({ path: `bin/${index}`, sha256: "a".repeat(64) })) }).success).toBe(false);
});
test("candidate receipts freeze complete materials, replay after deletion and export an admitted baseline", async () => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "material test" } });
  const authorHash = "a".repeat(40), author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: authorHash } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash: authorHash, manifest: { ...f.manifest, name: "author", uses: ["*"],
      authority: "owner"
}, intent: {}, report: {}, source: "user", status: "approved" } });
  const ports = { db, dataDir: f.root, publicUrl: null, now: () => new Date() }, owner = { kind: "owner" as const, via: null };
  const caller = { kind: "module" as const, module: "author", moduleId: author.id, hash: authorHash };
  const content = join(f.root, "platform/content", author.id); await mkdir(content, { recursive: true });
  const { rename } = await import("node:fs/promises"); await rename(f.dir, join(content, "submitted"));
  const admission = await admitCandidates(ports, workspace.id, owner, { requestKey: "admit", submitter: { moduleId: author.id, hash: authorHash }, targets: [{ name: "fixture", moduleId: null, expectedActiveHash: null }] });
  const input = { admissionId: admission.admissionId, requestKey: "submit", items: [{ name: "fixture", dir: "submitted", intent: { changes: ["material"], preserves: [] } }] };
  const files = await snapshotModuleMaterial(content, "submitted"), receipt = await submitCandidates(ports, workspace.id, caller, input), member = receipt.members[0]!;
  expect(member.materialDigest).toBe(moduleMaterialDigest(files));
  await rm(join(content, "submitted"), { recursive: true });
  expect(await submitCandidates(ports, workspace.id, caller, input)).toEqual(receipt);
  await db.moduleVersion.update({ where: { id: member.versionId }, data: { status: "approved" } });
  await db.module.update({ where: { id: member.moduleId }, data: { activeHash: member.hash } });
  const baseline = await admitCandidates(ports, workspace.id, owner, { requestKey: "baseline", submitter: { moduleId: author.id, hash: authorHash }, targets: [{ name: "fixture", moduleId: member.moduleId, expectedActiveHash: member.hash }] });
  const exported = await candidateSource(ports, workspace.id, caller, { admissionId: baseline.admissionId, moduleId: member.moduleId, hash: member.hash, to: "exported" });
  expect(exported.materialDigest).toBe(member.materialDigest);
  expect(await readFile(join(content, "exported/bin/program"))).toEqual(f.binary);
  expect((await stat(join(content, "exported/bin/program"))).mode & 0o111).toBe(0o111);
});

test.each(["none", "bytes", "extra"])("the native checker preserves frozen artifacts and rollback bytes (mutation=%s)", async mutate => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "native material checker test" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "fixture" } });
  const manifest = { ...f.manifest, entry: { path: "bin/program", args: ["--wire"] } };
  await writeFile(join(f.dir, "module.json"), JSON.stringify(manifest));
  const context = moduleContext({ db, dataDir: f.root, publicUrl: null, now: () => new Date() }, workspace.id);
  const files = await snapshotModuleMaterial(f.root, "submitted");
  const revision = await commitModuleSource({ platform: context.platform, moduleId: module.id, versionId: "first", files, message: "native fixture" });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: revision.commit, manifest, source: "user", intent: { changes: ["native artifact"], preserves: [] }, status: "building", report: { tests: [], git: revision } } });
  await rm(f.dir, { recursive: true });
  let checked = 0;
  const assertCopy = async (codeDir: string) => {
    expect(await readFile(join(codeDir, "bin/program"))).toEqual(f.binary);
    expect((await stat(join(codeDir, "bin/program"))).mode & 0o111).toBe(0o111);
    checked++;
  };
  const peer = testModuleProcess(async (_event, _call, input) => { await assertCopy(input.codeDir); return {}; });
  const sandbox = { available: true, isolated: false, startModule: peer.startModule, runModule: async (input: { codeDir: string }) => {
    await assertCopy(input.codeDir);
    if (mutate === "extra") {
      await mkdir(join(input.codeDir, "dist"));
      await writeFile(join(input.codeDir, "dist/helper.js"), "unbound runtime code");
    }
    if (mutate === "bytes") {
      await chmod(join(input.codeDir, "bin/program"), 0o755);
      await writeFile(join(input.codeDir, "bin/program"), "mutated by offline test");
    }
    return { status: "succeeded" as const, output: '{"effects":[]}', error: null, exitCode: 0 };
  } };
  await buildPending(moduleContext({ ...context.ports, sandbox }, workspace.id));
  expect(checked).toBeGreaterThan(0);
  const result = await db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } });
  if (mutate !== "none") {
    expect(result.status).toBe("rejected");
    await expect(stat(join(context.store, revision.commit))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.module.findUniqueOrThrow({ where: { id: module.id } })).activeHash).toBeNull();
    expect((await readModuleMaterial({ platform: context.platform, moduleId: module.id, commit: revision.commit })).find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
    return;
  }
  expect(result.status).toBe("approved");
  const installed = join(context.store, revision.commit);
  expect(await readFile(join(installed, "bin/program"))).toEqual(f.binary);
  expect((await stat(join(installed, "bin/program"))).mode & 0o777).toBe(0o555);
  // An absent runtime copy is reconstructed from Git and CAS, without running a compiler.
  await rm(installed, { recursive: true });
  await rollback(context, module.id, revision.commit);
  expect(await readFile(join(installed, "bin/program"))).toEqual(f.binary);
  expect((await stat(join(installed, "bin/program"))).mode & 0o777).toBe(0o555);
  await chmod(join(installed, "bin/program"), 0o755);
  await writeFile(join(installed, "bin/program"), "changed runtime copy");
  await expect(ensureVersionMaterial(context, await db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } }))).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(installed, "bin/program"), "utf8")).toBe("changed runtime copy");
});

test("official source-only bundles install and update complete verified artifact material", async () => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  const resources = join(f.root, "external"), dir = join(resources, "files"), seeds = join(f.root, "module-git");
  await mkdir(resources); await mkdir(seeds);
  const { rename } = await import("node:fs/promises"); await rename(f.dir, dir);
  await writeFile(join(dir, "module.json"), JSON.stringify({ ...f.manifest, name: "files", entry: { path: "bin/program", args: [] } }));
  const releaseRepo = { platform: join(f.root, "release-platform"), moduleId: "files" };
  const publish = async (versionId: string) => {
    const files = await snapshotModuleMaterial(resources, "files");
    const revision = await commitModuleSource({ ...releaseRepo, versionId, files, message: versionId });
    const repo = moduleGitPath(releaseRepo.platform, "files"), bundlePath = join(seeds, "files.bundle");
    execFileSync("git", ["--git-dir", repo, "update-ref", "refs/heads/main", revision.commit]);
    await rm(bundlePath, { force: true });
    execFileSync("git", ["--git-dir", repo, "bundle", "create", bundlePath, "refs/heads/main"]);
    await writeFile(join(seeds, "lock.json"), JSON.stringify({ version: 1, modules: [{ name: "files", repository: null, branch: "main", commit: revision.commit, bundle: "files.bundle", bundleSha256: digest(await readFile(bundlePath)) }] }));
    return revision;
  };
  const first = await publish("first");
  const workspace = await db.workspace.create({ data: { name: "artifact release test" } });
  const ports = { db, dataDir: join(f.root, "runtime"), moduleExternalResources: resources, publicUrl: null, now: () => new Date() };
  const installerPorts = { ...ports, moduleExternalInstaller: createExternalModuleInstaller(ports) };
  const installed = await installExternal(installerPorts, workspace.id, { package: "files", mode: "install", requestKey: "native-install" });
  expect(installed).toMatchObject({ status: "building", hash: first.commit });
  const location = { platform: join(ports.dataDir, "platform"), moduleId: installed.moduleId! };
  const material = await readModuleMaterial({ ...location, commit: first.commit });
  expect(material.find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
  expect(material.find(file => file.path === "bin/program")!.executable).toBe(true);
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: location.moduleId, hash: first.commit } }, data: { status: "approved" } });
  await db.module.update({ where: { id: location.moduleId }, data: { activeHash: first.commit } });
  const next = Buffer.from([0, 255, 127, 10]);
  await writeFile(join(dir, "bin/program"), next);
  f.record.artifacts[0]!.sha256 = digest(next);
  await writeFile(join(dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  const second = await publish("second");
  const updated = await installExternal(installerPorts, workspace.id, { package: "files", mode: "update", requestKey: "native-update" });
  expect(updated).toMatchObject({ status: "building", hash: second.commit, moduleId: location.moduleId });
  expect((await readModuleMaterial({ ...location, commit: second.commit })).find(file => file.path === "bin/program")!.bytes).toEqual(next);
  expect((await readModuleMaterial({ ...location, commit: first.commit })).find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
  expect((await readModuleSource({ ...location, commit: second.commit })).some(file => file.path === "bin/program")).toBe(false);
});

test.each(["mixed", "mode", "replacement", "ancestor", "artifact", "root"] as const)("material snapshot rejects deferred %s changes", async change => {
  const f = await fixture(), original = ModuleDirectory.prototype.read;
  let changed = false;
  const read = spyOn(ModuleDirectory.prototype, "read").mockImplementation(async function (this: InstanceType<typeof ModuleDirectory>, path, limit) {
    const result = await original.call(this, path, limit);
    if (!changed && path === (change === "mixed" ? "module.json" : "bin/program")) {
      changed = true;
      if (change === "mixed") {
        await writeFile(join(f.dir, "module.json"), JSON.stringify({ ...f.manifest, uses: ["*"],
            authority: "owner"
        }));
        await writeFile(join(f.dir, "index.ts"), "export const newCode = true;");
      } else if (change === "artifact") await writeFile(join(f.dir, "bin/program"), "changed after read");
      else if (change === "root") {
        await rename(f.dir, join(f.root, "old-submitted"));
        await mkdir(f.dir);
      } else if (change === "mode") await chmod(join(f.dir, "index.ts"), 0o755);
      else if (change === "replacement") {
        await writeFile(join(f.dir, "replacement"), "export {};");
        await rename(join(f.dir, "replacement"), join(f.dir, "index.ts"));
      } else {
        await rename(join(f.dir, "bin"), join(f.dir, "old-bin"));
        await mkdir(join(f.dir, "bin"));
        await writeFile(join(f.dir, "bin/program"), f.binary, { mode: 0o755 });
      }
    }
    return result;
  });
  try { await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "conflict" }); expect(changed).toBe(true); }
  finally { read.mockRestore(); }
});

test("workspace selections ignore other files while installed trees reject undeclared code", async () => {
  const f = await fixture();
  for (const name of ["node_modules", ".venv", ".chrona"]) {
    await mkdir(join(f.dir, name)); await writeFile(join(f.dir, name, "installed"), "dependency");
  }
  const selected = await snapshotModuleMaterial(f.root, "submitted");
  expect(moduleMaterialDigest(await snapshotModuleMaterial(f.root, "submitted", { verifyTree: true }))).toBe(moduleMaterialDigest(selected));
  await mkdir(join(f.dir, "dist")); await writeFile(join(f.dir, "dist/helper.js"), "unbound");
  expect(moduleMaterialDigest(await snapshotModuleMaterial(f.root, "submitted"))).toBe(moduleMaterialDigest(selected));
  await expect(snapshotModuleMaterial(f.root, "submitted", { verifyTree: true })).rejects.toMatchObject({ code: "conflict" });
});

test.each([false, true])("CAS publishes complete objects without replacing concurrent winners (poison=%s)", async poison => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted");
  const parent = join(f.repository.platform, "artifacts/sha256"), object = join(parent, f.record.artifacts[0]!.sha256);
  const original = ModuleDirectory.prototype.write;
  let enter!: () => void, release!: () => void, first = true;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const write = spyOn(ModuleDirectory.prototype, "write").mockImplementation(async function (this: InstanceType<typeof ModuleDirectory>, file, mode) {
    if (first && file.path === "bytes") { first = false; enter(); await gate; }
    return original.call(this, file, mode);
  });
  const pending = storeModuleArtifacts(f.repository.platform, files);
  // Observe rejection immediately so a failed assertion cannot leave an unhandled writer.
  const settled = pending.then(() => null, error => error);
  try {
    await entered;
    await expect(stat(object)).rejects.toMatchObject({ code: "ENOENT" });
    if (poison) await mkdir(object); // An empty existing winner must also be preserved.
    else await storeModuleArtifacts(f.repository.platform, files);
    release();
    const error = await settled;
    if (poison) { expect(error).toMatchObject({ code: "ENOENT" }); expect(await readdir(object)).toEqual([]); }
    else { expect(error).toBeNull(); expect(await readFile(join(object, "bytes"))).toEqual(f.binary); }
    expect(await readdir(parent)).toEqual([f.record.artifacts[0]!.sha256]);
  } finally { release(); await settled; write.mockRestore(); }
});

test("CAS verifies the entire existing winner and preserves undeclared object files", async () => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted");
  await storeModuleArtifacts(f.repository.platform, files);
  const extra = join(f.repository.platform, "artifacts/sha256", f.record.artifacts[0]!.sha256, "extra");
  await writeFile(extra, "poison");
  await expect(storeModuleArtifacts(f.repository.platform, files)).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(extra, "utf8")).toBe("poison");
});

test.each(["missing", "intact", "bytes", "extra", "mode", "cas"] as const)("ordinary supervisor verifies approved material before startup (%s)", async state => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  await import("./module-effects");
  const { createModuleSupervisor } = await import("./module-supervisor");
  const workspace = await db.workspace.create({ data: { name: "material startup" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "fixture" } });
  const manifest = { ...f.manifest, entry: { path: "bin/program", args: [] } };
  await writeFile(join(f.dir, "module.json"), JSON.stringify(manifest));
  const peer = testModuleProcess(async () => ({}));
  const ports = { db, dataDir: f.root, publicUrl: null, now: () => new Date(), sandbox: { available: true, isolated: false, startModule: peer.startModule } };
  const context = moduleContext(ports, workspace.id), files = await snapshotModuleMaterial(f.root, "submitted");
  const revision = await commitModuleSource({ platform: context.platform, moduleId: module.id, versionId: "startup", files, message: "startup" });
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: revision.commit, manifest, source: "user", intent: {}, status: "approved", report: { tests: [], git: revision } } });
  await db.module.update({ where: { id: module.id }, data: { activeHash: revision.commit } });
  const installed = join(context.store, revision.commit);
  if (state !== "missing") await ensureVersionMaterial(context, version);
  if (state === "bytes") { await chmod(join(installed, "bin/program"), 0o755); await writeFile(join(installed, "bin/program"), "poison"); }
  if (state === "extra") await writeFile(join(installed, "helper.js"), "unbound");
  if (state === "mode") await chmod(join(installed, "bin/program"), 0o444);
  if (state === "cas") {
    const blob = join(context.platform, "artifacts/sha256", f.record.artifacts[0]!.sha256, "bytes");
    await chmod(blob, 0o644); await writeFile(blob, "poison");
  }
  const supervisor = createModuleSupervisor(ports);
  // Cleanup must stop the peer before disconnecting its database.
  closes.unshift(() => supervisor.stop());
  await supervisor.reconcile();
  expect(peer.processes).toHaveLength(state === "missing" || state === "intact" ? 1 : 0);
  if (state === "missing" || state === "intact") {
    expect(await readFile(join(installed, "bin/program"))).toEqual(f.binary);
    expect(peer.processes[0]!.input.entry).toEqual(manifest.entry);
    expect(peer.processes[0]!.input.env).not.toHaveProperty("CHRONA_AGENT_TOKEN");
  }
  if (state === "bytes") expect(await readFile(join(installed, "bin/program"), "utf8")).toBe("poison");
  if (state === "extra") expect(await readFile(join(installed, "helper.js"), "utf8")).toBe("unbound");
});

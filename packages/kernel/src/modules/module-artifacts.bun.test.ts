import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_MATERIAL_FILE, MODULE_SOURCE_MAX_BYTES, MODULE_SOURCE_MAX_FILES, MODULE_ARTIFACT_MAX_FILE_BYTES, moduleMaterialSchema } from "../../../contracts/src/steward/module-material";

// Engine imports must never inherit a developer/live database URL.
const databaseRoot = mkdtempSync(join(tmpdir(), "chrona-material-test-db-"));
process.env.DATABASE_URL = `file:${join(databaseRoot, "test.db")}`;
const [{ snapshotModuleMaterial, moduleMaterialDigest, moduleSourceFiles, storeModuleArtifacts, storeVersionMaterial, readStoredVersionMaterial }, { snapshotModule, ModuleDirectory, checkoutModule }, { admitCandidates, submitCandidates, candidateSource, checkCandidates }, { testDb }, { moduleContext }, { buildPending }, { ensureVersionMaterial }, { rollback }, { testModuleProcess }, { createExternalModuleInstaller, installExternal }] = await Promise.all([
  import("./module-artifacts"), import("./module-files"), import("./module-candidates"), import("../__testing__/test-db"), import("./module-context"), import("./module-build"), import("./module-source"), import("./module-activation"), import("../__testing__/module-test-process"), import("./module-install"),
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
test("explicit material keeps ignored source inputs and binary bytes in retained CAS, restoring executable copies", async () => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted");
  expect(files).toHaveLength(8);
  await expect(snapshotModule(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  const revision = await storeVersionMaterial(f.repository.platform, files);
  const source = moduleSourceFiles(await readStoredVersionMaterial(f.repository.platform, revision));
  expect(source.map(file => file.path)).toEqual(moduleSourceFiles(files).map(file => file.path));
  expect(source.some(file => file.path === "bin/program")).toBe(false);
  const blob = join(f.repository.platform, "artifacts/sha256", f.record.artifacts[0]!.sha256, "bytes");
  expect(await readFile(blob)).toEqual(f.binary);
  expect((await stat(blob)).mode & 0o777).toBe(0o444);
  // The mutable submitted output can disappear; immutable restoration does not rebuild it.
  await rm(f.dir, { recursive: true });
  expect(moduleMaterialDigest(await readStoredVersionMaterial(f.repository.platform, revision))).toBe(moduleMaterialDigest(files));
  await checkoutModule(f.root, "checkout", await readStoredVersionMaterial(f.repository.platform, revision));
  expect(await readFile(join(f.root, "checkout/bin/program"))).toEqual(f.binary);
  expect((await stat(join(f.root, "checkout/bin/program"))).mode & 0o777).toBe(0o755);
  expect((await stat(blob)).nlink).toBe(1);
  await writeFile(join(f.root, "checkout/bin/program"), "edited copy");
  expect(await readFile(blob)).toEqual(f.binary);
});
test("artifact bytes and executable mode bind the receipt and material version", async () => {
  const f = await fixture(), first = await snapshotModuleMaterial(f.root, "submitted");
  const a = await storeVersionMaterial(f.repository.platform, first);
  const replacement = Buffer.from([0, 1, 2, 255]);
  await writeFile(join(f.dir, "bin/program"), replacement);
  f.record.artifacts[0]!.sha256 = digest(replacement);
  await writeFile(join(f.dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  const second = await snapshotModuleMaterial(f.root, "submitted");
  const b = await storeVersionMaterial(f.repository.platform, second);
  expect(b).not.toBe(a); expect(moduleMaterialDigest(second)).not.toBe(moduleMaterialDigest(first));
  expect((await readStoredVersionMaterial(f.repository.platform, a)).find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
  f.record.artifacts[0]!.executable = false; await chmod(join(f.dir, "bin/program"), 0o644);
  await writeFile(join(f.dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  const third = await snapshotModuleMaterial(f.root, "submitted");
  const c = await storeVersionMaterial(f.repository.platform, third);
  expect(c).not.toBe(b); expect(moduleMaterialDigest(third)).not.toBe(moduleMaterialDigest(second));
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
test("explicit source at 2 MiB roundtrips through CAS and export; one extra byte is rejected", async () => {
  const f = await fixture(), initial = await snapshotModuleMaterial(f.root, "submitted");
  const otherBytes = moduleSourceFiles(initial).filter(file => file.path !== "index.ts").reduce((total, file) => total + file.bytes.byteLength, 0);
  const bytes = Buffer.alloc(MODULE_SOURCE_MAX_BYTES - otherBytes, 0x61);
  expect(bytes.byteLength).toBeGreaterThan(1024 * 1024);
  await writeFile(join(f.dir, "index.ts"), bytes);
  const files = await snapshotModuleMaterial(f.root, "submitted");
  expect(moduleSourceFiles(files).reduce((total, file) => total + file.bytes.byteLength, 0)).toBe(2 * 1024 * 1024);
  const revision = await storeVersionMaterial(f.repository.platform, files);
  expect(moduleSourceFiles(await readStoredVersionMaterial(f.repository.platform, revision))).toEqual(moduleSourceFiles(files));
  await checkoutModule(f.root, "exported", await readStoredVersionMaterial(f.repository.platform, revision));
  expect(moduleMaterialDigest(await snapshotModuleMaterial(f.root, "exported"))).toBe(moduleMaterialDigest(files));
  const oversized = Buffer.concat([bytes, Buffer.from("x")]);
  await writeFile(join(f.dir, "index.ts"), oversized);
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  await expect(storeVersionMaterial(f.repository.platform, files.map(file => file.path === "index.ts" ? { ...file, bytes: oversized } : file))).rejects.toMatchObject({ code: "invalid" });
});

test("source-only legacy layouts cannot enter retained materials", async () => {
  const f = await fixture();
  await rm(join(f.dir, MODULE_MATERIAL_FILE));
  await expect(snapshotModuleMaterial(f.root, "submitted")).rejects.toMatchObject({ code: "invalid" });
  await expect(storeVersionMaterial(f.repository.platform, [{ path: "index.ts", bytes: Buffer.from("unrecorded") }])).rejects.toMatchObject({ code: "invalid" });
});

test("source file counts remain bounded independently of bytes", async () => {
  const f = await fixture();
  const files = Array.from({ length: MODULE_SOURCE_MAX_FILES + 1 }, (_, index) => ({ path: `file-${index}`, bytes: Buffer.alloc(0) }));
  await expect(storeVersionMaterial(f.repository.platform, files)).rejects.toMatchObject({ code: "invalid" });
  expect(moduleMaterialSchema.safeParse({ ...f.record, source: ["module.json", ...files.slice(0, MODULE_SOURCE_MAX_FILES - 2).map(file => file.path)] }).success).toBe(true);
  expect(moduleMaterialSchema.safeParse({ ...f.record, source: ["module.json", ...files.slice(0, MODULE_SOURCE_MAX_FILES - 1).map(file => file.path)] }).success).toBe(false);
});

test("corrupt or missing immutable objects stop restoration and are preserved", async () => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted");
  const revision = await storeVersionMaterial(f.repository.platform, files);
  const blob = join(f.repository.platform, "artifacts/sha256", f.record.artifacts[0]!.sha256, "bytes");
  await chmod(blob, 0o644); await writeFile(blob, "corrupt");
  await expect(readStoredVersionMaterial(f.repository.platform, revision)).rejects.toMatchObject({ code: "conflict" });
  await expect(storeVersionMaterial(f.repository.platform, files)).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(blob, "utf8")).toBe("corrupt");
  await rm(blob);
  await expect(readStoredVersionMaterial(f.repository.platform, revision)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(storeVersionMaterial(f.repository.platform, files)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await stat(join(blob, ".."))).isDirectory()).toBe(true);
});
test("record paths are disjoint, portable, bounded and include module.json", async () => {
  const f = await fixture();
  for (const source of [["index.ts"], ["module.json", "module.json"], ["module.json", MODULE_MATERIAL_FILE], ["module.json", "bin"], ["module.json", "bin/program"], ["module.json", "../escape"], ["module.json", "node_modules/x"], ["module.json", "C:/x"]]) {
    expect(moduleMaterialSchema.safeParse({ ...f.record, source }).success).toBe(false);
  }
  expect(moduleMaterialSchema.safeParse({ ...f.record, artifacts: Array.from({ length: 1001 }, (_, index) => ({ path: `bin/${index}`, sha256: "a".repeat(64) })) }).success).toBe(false);
});
test.each([true, false])("candidate receipts freeze materials, replay and export an admitted baseline (artifacts=%s)", async artifacts => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  if (!artifacts) {
    await rm(join(f.dir, "bin"), { recursive: true });
    f.record.artifacts = [];
    f.record.build.commands = [];
    await writeFile(join(f.dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  }
  const workspace = await db.workspace.create({ data: { name: "material test" } });
  const authorMaterial = (await snapshotModuleMaterial(f.root, "submitted")).map(file =>
    file.path === "index.ts" ? { ...file, bytes: Buffer.from("// Author entry") } : file);
  const authorHash = await storeVersionMaterial(f.repository.platform, authorMaterial);
  const author = await db.module.create({ data: { workspaceId: workspace.id, name: "author", activeHash: authorHash } });
  await db.moduleVersion.create({ data: { moduleId: author.id, hash: authorHash, manifest: { ...f.manifest, name: "author", uses: ["*"],
      authority: "owner"
}, intent: {}, report: {}, source: "user", status: "approved" } });
  const ports = { db, dataDir: f.root, publicUrl: null, now: () => new Date() }, owner = { kind: "owner" as const, via: null };
  const caller = { kind: "module" as const, module: "author", moduleId: author.id, hash: authorHash };
  const content = join(f.root, "platform/content", author.id); await mkdir(content, { recursive: true });
  const { rename } = await import("node:fs/promises"); await rename(f.dir, join(content, "submitted"));
  const admission = await admitCandidates(ports, workspace.id, owner, { requestKey: "admit", submitter: { moduleId: author.id, hash: authorHash }, target: { name: "fixture", moduleId: null, expectedActiveHash: null } });
  const input = { admissionId: admission.admissionId, requestKey: "submit", item: { name: "fixture", dir: "submitted", intent: { changes: ["material"], preserves: [] } } };
  const files = await snapshotModuleMaterial(content, "submitted"), receipt = await submitCandidates(ports, workspace.id, caller, input), member = receipt.member;
  expect(member.materialDigest).toBe(moduleMaterialDigest(files));
  await rm(join(content, "submitted"), { recursive: true });
  expect(await submitCandidates(ports, workspace.id, caller, input)).toEqual(receipt);
  const version = await db.moduleVersion.update({ where: { id: member.versionId }, data: { status: "approved" } });
  await db.module.update({ where: { id: member.moduleId }, data: { activeHash: member.hash } });
  const baseline = await admitCandidates(ports, workspace.id, owner, { requestKey: "baseline", submitter: { moduleId: author.id, hash: authorHash }, target: { name: "fixture", moduleId: member.moduleId, expectedActiveHash: member.hash } });
  const exported = await candidateSource(ports, workspace.id, caller, { admissionId: baseline.admissionId, moduleId: member.moduleId, hash: member.hash, to: "exported" });
  expect(exported.materialDigest).toBe(member.materialDigest);
  if (artifacts) {
    expect(await readFile(join(content, "exported/bin/program"))).toEqual(f.binary);
    expect((await stat(join(content, "exported/bin/program"))).mode & 0o111).toBe(0o111);
  } else {
    const context = moduleContext(ports, workspace.id), checkout = join(context.store, member.hash);
    await expect(stat(checkout)).rejects.toMatchObject({ code: "ENOENT" });
    await ensureVersionMaterial(context, version);
    expect(await readFile(join(checkout, "index.ts"), "utf8")).toBe("export {};");
    expect(moduleMaterialDigest(await snapshotModuleMaterial(context.platform, `store/${member.hash}`, { verifyTree: true }))).toBe(member.materialDigest);
  }
  const check = () => checkCandidates(ports, workspace.id, caller, { receiptId: receipt.receiptId });
  expect(await check()).toMatchObject({ state: "approved", member: { selected: true } });
  await db.module.update({ where: { id: member.moduleId }, data: { activeHash: null } });
  const { collectStore } = await import("../store-gc");
  const later = new Date(version.createdAt.getTime() + 31 * 24 * 3600_000);
  expect(await collectStore(ports, later)).toMatchObject({ versionsRemoved: 1, indexesRemoved: 1 });
  const archived = await check();
  expect(archived).toMatchObject({ state: "approved", member: { versionId: member.versionId, status: "approved", selected: false } });
  expect(await submitCandidates(ports, workspace.id, caller, input)).toEqual(archived);
  const duplicate = await admitCandidates(ports, workspace.id, owner, { requestKey: "duplicate", submitter: { moduleId: author.id, hash: authorHash },
    target: { name: "fixture", moduleId: member.moduleId, expectedActiveHash: null } });
  await checkoutModule(content, "duplicate", files);
  await expect(submitCandidates(ports, workspace.id, caller, { ...input, admissionId: duplicate.admissionId, requestKey: "duplicate",
    item: { ...input.item, dir: "duplicate" } })).rejects.toThrow("terminal versions cannot be resubmitted");
});

test.each(["none", "bytes", "extra"])("the native checker preserves frozen artifacts and rollback bytes (mutation=%s)", async mutate => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  const workspace = await db.workspace.create({ data: { name: "native material checker test" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "fixture" } });
  const manifest = { ...f.manifest, entry: { path: "bin/program", args: ["--wire"] } };
  await writeFile(join(f.dir, "module.json"), JSON.stringify(manifest));
  const context = moduleContext({ db, dataDir: f.root, publicUrl: null, now: () => new Date() }, workspace.id);
  const files = await snapshotModuleMaterial(f.root, "submitted");
  const revision = await storeVersionMaterial(context.platform, files);
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: revision, manifest, source: "user", intent: { changes: ["native artifact"], preserves: [] }, status: "building", report: { tests: [] } } });
  await rm(f.dir, { recursive: true });
  let checked = 0;
  const peer = testModuleProcess(async () => ({}));
  const sandbox = { available: true, isolated: false, startModule(input: Parameters<typeof peer.startModule>[0]) {
    expect(readFileSync(join(input.codeDir, "bin/program"))).toEqual(f.binary);
    expect(statSync(join(input.codeDir, "bin/program")).mode & 0o111).toBe(0o111);
    checked++;
    if (mutate === "extra") {
      mkdirSync(join(input.codeDir, "dist"));
      writeFileSync(join(input.codeDir, "dist/helper.js"), "unbound runtime code");
    }
    if (mutate === "bytes") {
      chmodSync(join(input.codeDir, "bin/program"), 0o755);
      writeFileSync(join(input.codeDir, "bin/program"), "mutated at startup");
    }
    return peer.startModule(input);
  } };
  await buildPending(moduleContext({ ...context.ports, sandbox }, workspace.id));
  const result = await db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } });
  expect(checked).toBeGreaterThan(0);
  if (mutate !== "none") {
    expect(result.status).toBe("rejected");
    await expect(stat(join(context.store, revision))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.module.findUniqueOrThrow({ where: { id: module.id } })).activeHash).toBeNull();
    expect((await readStoredVersionMaterial(context.platform, revision)).find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
    return;
  }
  expect(result.status).toBe("approved");
  const installed = join(context.store, revision);
  expect(await readFile(join(installed, "bin/program"))).toEqual(f.binary);
  expect((await stat(join(installed, "bin/program"))).mode & 0o777).toBe(0o555);
  // An absent runtime copy is reconstructed from retained CAS, without running a compiler.
  await rm(installed, { recursive: true });
  await rollback(context, module.id, revision);
  expect(await readFile(join(installed, "bin/program"))).toEqual(f.binary);
  expect((await stat(join(installed, "bin/program"))).mode & 0o777).toBe(0o555);
  await chmod(join(installed, "bin/program"), 0o755);
  await writeFile(join(installed, "bin/program"), "changed runtime copy");
  await expect(ensureVersionMaterial(context, await db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } }))).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(installed, "bin/program"), "utf8")).toBe("changed runtime copy");
});

test("offline releases install and update complete verified material without Git", async () => {
  const f = await fixture(), db = testDb(); closes.push(() => db.$disconnect());
  const resources = join(f.root, "external"), dir = join(resources, "files");
  await mkdir(resources); await rename(f.dir, dir);
  await writeFile(join(dir, "module.json"), JSON.stringify({ ...f.manifest, name: "files", entry: { path: "bin/program", args: [] } }));
  const first = moduleMaterialDigest(await snapshotModuleMaterial(resources, "files"));
  const workspace = await db.workspace.create({ data: { name: "artifact release test" } });
  const ports = { db, dataDir: join(f.root, "runtime"), moduleExternalResources: resources, publicUrl: null, now: () => new Date() };
  const installerPorts = { ...ports, moduleExternalInstaller: createExternalModuleInstaller(ports) };
  const installed = await installExternal(installerPorts, workspace.id, { package: "files", mode: "install", requestKey: "native-install" });
  expect(installed).toMatchObject({ status: "building", hash: first });
  const platform = join(ports.dataDir, "platform");
  const material = await readStoredVersionMaterial(platform, first);
  expect(material.find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
  expect(material.find(file => file.path === "bin/program")!.executable).toBe(true);
  await db.moduleVersion.update({ where: { moduleId_hash: { moduleId: installed.moduleId!, hash: first } }, data: { status: "approved" } });
  await db.module.update({ where: { id: installed.moduleId! }, data: { activeHash: first } });
  const next = Buffer.from([0, 255, 127, 10]);
  await writeFile(join(dir, "bin/program"), next);
  f.record.artifacts[0]!.sha256 = digest(next);
  await writeFile(join(dir, MODULE_MATERIAL_FILE), JSON.stringify(f.record));
  const second = moduleMaterialDigest(await snapshotModuleMaterial(resources, "files"));
  const updated = await installExternal(installerPorts, workspace.id, { package: "files", mode: "update", requestKey: "native-update" });
  expect(updated).toMatchObject({ status: "building", hash: second, moduleId: installed.moduleId });
  expect((await readStoredVersionMaterial(platform, second)).find(file => file.path === "bin/program")!.bytes).toEqual(next);
  expect((await readStoredVersionMaterial(platform, first)).find(file => file.path === "bin/program")!.bytes).toEqual(f.binary);
  expect(moduleSourceFiles(await readStoredVersionMaterial(platform, second)).some(file => file.path === "bin/program")).toBe(false);
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
  const revision = await storeVersionMaterial(context.platform, files);
  const version = await db.moduleVersion.create({ data: { moduleId: module.id, hash: revision, manifest, source: "user", intent: {}, status: "approved", report: { tests: [] } } });
  await db.module.update({ where: { id: module.id }, data: { activeHash: revision } });
  const installed = join(context.store, revision);
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

test("source bytes and executable modes remain recoverable independently of checkout copies", async () => {
  const f = await fixture();
  await chmod(join(f.dir, "build.sh"), 0o755);
  const files = await snapshotModuleMaterial(f.root, "submitted"), hash = await storeVersionMaterial(f.repository.platform, files);
  await chmod(join(f.dir, "build.sh"), 0o644);
  const changed = await snapshotModuleMaterial(f.root, "submitted");
  expect(moduleMaterialDigest(changed)).not.toBe(hash);
  await rm(f.dir, { recursive: true });
  const restored = await readStoredVersionMaterial(f.repository.platform, hash);
  expect(restored.find(file => file.path === "build.sh")!.executable).toBe(true);
  expect(restored.find(file => file.path === "deps.lock")!.bytes).toEqual(Buffer.from("pinned"));
  expect(restored.find(file => file.path === ".gitignore")!.bytes).toEqual(Buffer.from("bin/\n"));
  expect(restored.find(file => file.path === MODULE_MATERIAL_FILE)!.bytes).toEqual(files.find(file => file.path === MODULE_MATERIAL_FILE)!.bytes);
});

test.each(["source", "index", "mode", "extra"] as const)("retained material rejects and preserves %s pollution", async kind => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted"), hash = await storeVersionMaterial(f.repository.platform, files);
  const index = join(f.repository.platform, "materials/sha256", hash, "bytes");
  if (kind === "source") {
    const blob = join(f.repository.platform, "artifacts/sha256", digest(Buffer.from("pinned")), "bytes");
    await chmod(blob, 0o644); await writeFile(blob, "polluted source lock");
    await expect(readStoredVersionMaterial(f.repository.platform, hash)).rejects.toThrow();
    await expect(storeVersionMaterial(f.repository.platform, files)).rejects.toThrow();
    expect(await readFile(blob, "utf8")).toBe("polluted source lock");
  } else {
    const changed = JSON.parse(await readFile(index, "utf8"));
    if (kind === "index") changed[0].sha256 = "a".repeat(64);
    if (kind === "mode") changed[0].executable = !changed[0].executable;
    if (kind === "extra") await writeFile(join(index, "..", "extra"), "keep");
    else { await chmod(index, 0o644); await writeFile(index, JSON.stringify(changed)); }
    const before = await readFile(index);
    await expect(readStoredVersionMaterial(f.repository.platform, hash)).rejects.toThrow();
    await expect(storeVersionMaterial(f.repository.platform, files)).rejects.toThrow();
    expect(await readFile(index)).toEqual(before);
    if (kind === "extra") expect(await readFile(join(index, "..", "extra"), "utf8")).toBe("keep");
  }
});

test.each([false, true])("source index publication verifies the concurrent winner (poison=%s)", async poison => {
  const f = await fixture(), files = await snapshotModuleMaterial(f.root, "submitted"), hash = moduleMaterialDigest(files);
  const index = join(f.repository.platform, "materials/sha256", hash);
  const publish = ModuleDirectory.prototype.publishImmutable;
  let entered!: () => void, release!: () => void, first = true;
  const ready = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const spy = spyOn(ModuleDirectory.prototype, "publishImmutable").mockImplementation(async function (this: InstanceType<typeof ModuleDirectory>, name, bytes) {
    if (first && name === hash) { first = false; entered(); await gate; }
    return publish.call(this, name, bytes);
  });
  const pending = storeVersionMaterial(f.repository.platform, files).then(() => null, error => error);
  try {
    await ready;
    if (poison) await mkdir(index);
    else await storeVersionMaterial(f.repository.platform, files);
    const before = await stat(index);
    release();
    if (poison) { expect(await pending).not.toBeNull(); expect(await readdir(index)).toEqual([]); }
    else { expect(await pending).toBeNull(); expect(moduleMaterialDigest(await readStoredVersionMaterial(f.repository.platform, hash))).toBe(hash); }
    expect((await stat(index)).ino).toBe(before.ino);
  } finally { release(); await pending; spy.mockRestore(); }
});

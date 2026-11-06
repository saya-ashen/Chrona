import { afterEach, expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { moduleContext } from "./module-context";
import { commitModuleSource } from "./module-git";
import { readVersionSource } from "./module-source";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-module-source-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspace = await db.workspace.create({ data: { name: "source" } });
  const module = await db.module.create({ data: { workspaceId: workspace.id, name: "sample" } });
  const context = moduleContext({ db, dataDir, now: () => new Date() } as StewardPorts, workspace.id);
  const files = [{ path: "index.ts", bytes: Buffer.from("export {};\n") }];
  async function version(hash: string, report: object = {}) {
    return db.moduleVersion.create({ data: { moduleId: module.id, hash, manifest: {}, intent: {}, source: "user", status: "pending_review", report: { tests: [], ...report } } });
  }
  return { db, context, module, files, version };
}

test("commit source is exact even when runtime artifacts differ", async () => {
  const f = await fixture();
  const git = await commitModuleSource({ platform: f.context.platform, moduleId: f.module.id, versionId: "candidate", files: f.files, message: "candidate" });
  await f.version(git.commit, { git });
  const artifact = join(f.context.store, git.commit);
  await mkdir(artifact, { recursive: true });
  await writeFile(join(artifact, "index.ts"), "runtime generated cache");
  expect(await readVersionSource(f.context, f.module.id, git.commit)).toEqual(f.files);
  await expect(readVersionSource({ ...f.context, workspaceId: "other" }, f.module.id, git.commit)).rejects.toMatchObject({ code: "not_found" });
});

test("legacy import preserves approval hash and pending state, and detects changed source", async () => {
  const f = await fixture(), digest = createHash("sha256");
  for (const file of f.files) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  const hash = digest.digest("hex"), version = await f.version(hash);
  await f.db.module.update({ where: { id: f.module.id }, data: { activeHash: hash } });
  const artifact = join(f.context.store, hash);
  await mkdir(artifact, { recursive: true });
  await writeFile(join(artifact, "index.ts"), f.files[0]!.bytes);
  expect(await readVersionSource(f.context, f.module.id, hash)).toEqual(f.files);
  const imported = await f.db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } });
  expect(imported).toMatchObject({ hash, status: "pending_review", report: { git: { commit: expect.stringMatching(/^[a-f0-9]{40}$/) } } });
  expect((await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).activeHash).toBe(hash);
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { report: { tests: [] } } });
  await writeFile(join(artifact, "index.ts"), "changed by build");
  await expect(readVersionSource(f.context, f.module.id, hash)).rejects.toMatchObject({ code: "conflict" });
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ hash, status: "pending_review", report: { tests: [] } });
});

test("a commit hash cannot use another commit's provenance", async () => {
  const f = await fixture();
  await f.version("a".repeat(40), { git: { commit: "b".repeat(40), tree: "c".repeat(40) } });
  await expect(readVersionSource(f.context, f.module.id, "a".repeat(40))).rejects.toMatchObject({ code: "conflict" });
});

test("legacy built-in source imports only the exact trusted release when no store exists", async () => {
  const f = await fixture(), resources = join(f.context.ports.dataDir, "release"), code = join(resources, "web");
  f.context.ports.moduleBuiltinResources = resources;
  const manifest = moduleManifestSchema.parse({ name: "web", entry: "index.ts", tests: ["test.ts"], triggers: [], effects: [], keepAlive: true });
  const files = [
    { path: "index.ts", bytes: Buffer.from("legacy release") },
    { path: "module.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { path: "test.ts", bytes: Buffer.from("// synthetic") },
  ];
  await mkdir(code, { recursive: true });
  const digest = createHash("sha256");
  for (const file of files) { await writeFile(join(code, file.path), file.bytes); digest.update(file.path).update("\0").update(file.bytes).update("\0"); }
  const hash = digest.digest("hex");
  await f.db.module.update({ where: { id: f.module.id }, data: { name: "web", builtin: true, activeHash: hash } });
  const version = await f.version(hash);
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { source: "builtin", manifest } });
  expect(await readVersionSource(f.context, f.module.id, hash)).toEqual(files);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ name: "web", builtin: true, activeHash: hash });
  expect(await f.db.moduleVersion.findUniqueOrThrow({ where: { id: version.id } })).toMatchObject({ hash, status: "pending_review", source: "builtin" });
  await expect(stat(join(f.context.store, hash))).rejects.toMatchObject({ code: "ENOENT" });
  await f.db.moduleVersion.update({ where: { id: version.id }, data: { report: { tests: [] } } });
  await writeFile(join(code, "index.ts"), "new release cannot impersonate old source");
  await expect(readVersionSource(f.context, f.module.id, hash)).rejects.toMatchObject({ code: "conflict" });
  expect(await readFile(join(code, "index.ts"), "utf8")).toBe("new release cannot impersonate old source");
});

import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitModuleSource, ensureModuleGit, exportModuleSource, getModuleLocalHead, importLegacyModuleSource, moduleGitPath, readModuleSource, type ModuleGitFile } from "./module-git";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const platform = await mkdtemp(join(tmpdir(), "chrona-module-git-")); roots.push(platform);
  return { platform, moduleId: "module-a" };
}
const files: ModuleGitFile[] = [{ path: "module.json", bytes: Buffer.from("{}") }, { path: "nested/binary", bytes: Buffer.from([0, 128, 255]) }];
function save(base: Awaited<ReturnType<typeof fixture>>, versionId: string, source = files, parent?: string) {
  return commitModuleSource({ ...base, versionId, files: source, parent, message: versionId });
}
test("module Git roundtrips bytes and exports only fixed source into an empty destination", async () => {
  const base = await fixture(), revision = await save(base, "v1");
  expect(revision.commit).toMatch(/^[a-f0-9]{40}$/);
  expect((await readModuleSource({ ...base, commit: revision.commit })).map(file => [file.path, Buffer.from(file.bytes)])).toEqual(files.map(file => [file.path, Buffer.from(file.bytes)]));
  await exportModuleSource({ ...base, commit: revision.commit, root: base.platform, dir: "candidate" });
  expect(await readFile(join(base.platform, "candidate/nested/binary"))).toEqual(Buffer.from([0, 128, 255]));
  await expect(exportModuleSource({ ...base, commit: revision.commit, root: base.platform, dir: "candidate" })).rejects.toMatchObject({ code: "conflict" });
});
test("same tree reuses commit; changed source preserves parent, deletion and candidate pins", async () => {
  const base = await fixture(), first = await save(base, "v1"), duplicate = await save(base, "v2", [...files].reverse());
  expect(duplicate).toEqual(first);
  const next = await save(base, "v3", [files[0]!]);
  expect(next.commit).not.toBe(first.commit);
  const repo = moduleGitPath(base.platform, base.moduleId);
  expect(execFileSync("git", ["--git-dir", repo, "rev-parse", `${next.commit}^`], { encoding: "utf8" }).trim()).toBe(first.commit);
  expect(execFileSync("git", ["--git-dir", repo, "rev-parse", "refs/chrona/candidates/v1"], { encoding: "utf8" }).trim()).toBe(first.commit);
  expect((await readModuleSource({ ...base, commit: next.commit })).map(file => file.path)).toEqual(["module.json"]);
  await expect(save(base, "v4", files, first.commit)).rejects.toMatchObject({ code: "conflict" });
  await expect(save(base, "v1", [{ path: "changed", bytes: Buffer.from("changed") }])).rejects.toMatchObject({ code: "conflict" });
});
test("module IDs isolate repositories, not manifest names", async () => {
  const base = await fixture();
  await save(base, "v1");
  const other = { ...base, moduleId: "module-b" };
  await save(other, "v1", [files[0]!]);
  expect(moduleGitPath(base.platform, base.moduleId)).not.toBe(moduleGitPath(other.platform, other.moduleId));
});
test.each(["../outside", "/outside", "nested/.git/config", "a\\b", "a//b", "node_modules/a"])("rejects unsafe source path %s", async path => {
  await expect(save(await fixture(), "v1", [{ path, bytes: Buffer.from("x") }])).rejects.toMatchObject({ code: "invalid" });
});
test("rejects symlink repository roots and Git symlink objects", async () => {
  const base = await fixture(), outside = await fixture();
  await mkdir(join(base.platform, "repos"));
  await symlink(outside.platform, moduleGitPath(base.platform, base.moduleId));
  await expect(ensureModuleGit(base.platform, base.moduleId)).rejects.toMatchObject({ code: "forbidden" });
  await rm(moduleGitPath(base.platform, base.moduleId));
  await ensureModuleGit(base.platform, base.moduleId);
  const repo = moduleGitPath(base.platform, base.moduleId);
  const blob = execFileSync("git", ["--git-dir", repo, "hash-object", "-w", "--stdin"], { input: "/outside", encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["--git-dir", repo, "mktree"], { input: `120000 blob ${blob}\tlink\n`, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["--git-dir", repo, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit-tree", tree], { input: "unsafe", encoding: "utf8" }).trim();
  await expect(readModuleSource({ ...base, commit })).rejects.toMatchObject({ code: "forbidden" });
});
test("legacy import verifies original digest, preserves files, and does not advance local", async () => {
  const base = await fixture(), first = await save(base, "v1", [files[0]!]);
  const digest = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) digest.update(file.path).update("\0").update(file.bytes).update("\0");
  const legacyHash = digest.digest("hex"), imported = await importLegacyModuleSource({ ...base, legacyHash, files });
  expect(await importLegacyModuleSource({ ...base, legacyHash, files })).toEqual(imported);
  await expect(importLegacyModuleSource({ ...base, legacyHash, files: [files[0]!] })).rejects.toMatchObject({ code: "conflict" });
  expect(await save(base, "v2", [files[0]!])).toEqual(first);
  expect(files).toHaveLength(2);
});
test("missing Git reports required executable explicitly", async () => {
  const base = await fixture(), previous = process.env.PATH;
  try {
    process.env.PATH = base.platform;
    await expect(ensureModuleGit(base.platform, base.moduleId)).rejects.toThrow("Git is required");
  } finally { process.env.PATH = previous; }
});
test("concurrent submissions keep every candidate pin and never lose successful local history", async () => {
  const base = await fixture();
  await save(base, "initial");
  const outcomes = await Promise.allSettled([save(base, "race-a", [{ path: "a", bytes: Buffer.from("a") }]), save(base, "race-b", [{ path: "b", bytes: Buffer.from("b") }])]);
  const repo = moduleGitPath(base.platform, base.moduleId), local = await getModuleLocalHead(base);
  expect(outcomes.some(result => result.status === "fulfilled")).toBe(true);
  for (const name of ["race-a", "race-b"]) expect(execFileSync("git", ["--git-dir", repo, "rev-parse", `refs/chrona/candidates/${name}`], { encoding: "utf8" }).trim()).toMatch(/^[a-f0-9]{40}$/);
  for (const result of outcomes) if (result.status === "fulfilled") expect(execFileSync("git", ["--git-dir", repo, "merge-base", "--is-ancestor", result.value.commit, local!]).byteLength).toBe(0);
});

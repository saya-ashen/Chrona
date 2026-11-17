import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptModuleGitCandidate, commitModuleSource, getModuleLocalHead, moduleGitPath, readModuleSource, type ModuleGitFile } from "./module-git";
import { fetchModuleUpstream, getModuleUpstreamHead, importModuleGitBundle, mergeModuleUpstream, verifyModuleGitBundle } from "./module-git-upstream";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const file = (path: string, text: string): ModuleGitFile => ({ path, bytes: Buffer.from(text) });
const initial = [file("module.json", "{}"), file("base.txt", "base\n")];
function git(repo: string, args: string[]) { return execFileSync("git", ["--git-dir", repo, ...args], { encoding: "utf8" }).trim(); }
async function fixture() {
  const platform = await mkdtemp(join(tmpdir(), "chrona-upstream-test-")); roots.push(platform);
  const source = { platform, moduleId: "official" }, target = { platform, moduleId: "installed" };
  const first = await commitModuleSource({ ...source, versionId: "first", files: [initial[0]!], message: "Real official initial commit" });
  const release = await commitModuleSource({ ...source, versionId: "release", files: initial, message: "Real official release" });
  const bundlePath = join(platform, "official.bundle"), repo = moduleGitPath(platform, source.moduleId);
  git(repo, ["update-ref", "refs/heads/main", release.commit]);
  git(repo, ["bundle", "create", bundlePath, "refs/heads/main"]);
  const bundle = { bundlePath, commit: release.commit, branch: "main", repository: null };
  return { platform, source, target, first, release, bundle, repo };
}
test("verified full bundle retains real history and null origin does not invent an upstream", async () => {
  const f = await fixture(), verified = await verifyModuleGitBundle(f.bundle);
  expect(verified.commit).toBe(f.release.commit);
  expect(verified.files.map(entry => entry.path)).toEqual(["base.txt", "module.json"]);
  expect(await importModuleGitBundle({ ...f.target, ...f.bundle })).toEqual(f.release);
  const repo = moduleGitPath(f.platform, f.target.moduleId);
  expect(git(repo, ["rev-list", "--count", f.release.commit])).toBe("2");
  expect(git(repo, ["rev-parse", `${f.release.commit}^`])).toBe(f.first.commit);
  expect(await getModuleLocalHead(f.target)).toBe(f.release.commit);
  expect(await getModuleUpstreamHead({ ...f.target, branch: "main" })).toBeUndefined();
  expect(git(repo, ["remote"])).toBe("");
  await importModuleGitBundle({ ...f.target, ...f.bundle, repository: "https://github.com/chrona/example.git" });
  expect(await getModuleUpstreamHead({ ...f.target, branch: "main" })).toBe(f.release.commit);
  expect(git(repo, ["config", "--get", "remote.upstream.url"])).toBe("https://github.com/chrona/example.git");
  expect(git(repo, ["config", "--get", "remote.upstream.fetch"])).toBe("+refs/heads/main:refs/remotes/upstream/main");
});
test("bundle pin and branch mismatch or symlink bundle are rejected", async () => {
  const f = await fixture();
  await expect(verifyModuleGitBundle({ ...f.bundle, commit: f.first.commit })).rejects.toMatchObject({ code: "conflict" });
  await expect(verifyModuleGitBundle({ ...f.bundle, branch: "other" })).rejects.toMatchObject({ code: "conflict" });
  const link = join(f.platform, "link.bundle"); await symlink(f.bundle.bundlePath, link);
  await expect(importModuleGitBundle({ ...f.target, ...f.bundle, bundlePath: link })).rejects.toMatchObject({ code: "forbidden" });
});
test("diverged upstream merge keeps fork unchanged until exact two-parent candidate adoption", async () => {
  const f = await fixture();
  await importModuleGitBundle({ ...f.target, ...f.bundle });
  const fork = await commitModuleSource({ ...f.target, versionId: "fork", files: [...initial, file("local.txt", "custom")], message: "Local customization" });
  const upstream = await commitModuleSource({ ...f.source, versionId: "update", files: [...initial, file("upstream.txt", "official")], message: "Official update" });
  git(f.repo, ["update-ref", "refs/heads/main", upstream.commit]);
  const bundlePath = join(f.platform, "update.bundle"); git(f.repo, ["bundle", "create", bundlePath, "refs/heads/main"]);
  await importModuleGitBundle({ ...f.target, ...f.bundle, bundlePath, commit: upstream.commit });
  expect(await getModuleLocalHead(f.target)).toBe(fork.commit);
  const merged = await mergeModuleUpstream({ ...f.target, versionId: "merge", upstreamCommit: upstream.commit });
  expect(await getModuleLocalHead(f.target)).toBe(fork.commit);
  expect(merged.files.map(entry => entry.path)).toEqual(["base.txt", "local.txt", "module.json", "upstream.txt"]);
  const repo = moduleGitPath(f.platform, f.target.moduleId);
  expect(git(repo, ["rev-parse", `${merged.commit}^1`])).toBe(fork.commit);
  expect(git(repo, ["rev-parse", `${merged.commit}^2`])).toBe(upstream.commit);
  expect(await adoptModuleGitCandidate({ ...f.target, versionId: "merge", commit: merged.commit, parent: fork.commit })).toEqual({ commit: merged.commit, tree: merged.tree });
  expect(await getModuleLocalHead(f.target)).toBe(merged.commit);
  expect((await readModuleSource({ ...f.target, commit: fork.commit })).map(entry => entry.path)).toContain("local.txt");
});
test("fast-forward candidate keeps the exact upstream commit without advancing local", async () => {
  const f = await fixture(); await importModuleGitBundle({ ...f.target, ...f.bundle });
  const upstream = await commitModuleSource({ ...f.source, versionId: "update", files: [...initial, file("upstream.txt", "official")], message: "Official update" });
  git(f.repo, ["update-ref", "refs/heads/main", upstream.commit]);
  const bundlePath = join(f.platform, "update.bundle"); git(f.repo, ["bundle", "create", bundlePath, "refs/heads/main"]);
  await importModuleGitBundle({ ...f.target, ...f.bundle, bundlePath, commit: upstream.commit });
  const candidate = await mergeModuleUpstream({ ...f.target, versionId: "ff", upstreamCommit: upstream.commit });
  expect(candidate.commit).toBe(upstream.commit);
  expect(await getModuleLocalHead(f.target)).toBe(f.release.commit);
  expect(git(moduleGitPath(f.platform, f.target.moduleId), ["rev-parse", "refs/chrona/candidates/ff"])).toBe(upstream.commit);
});
test("already included upstream keeps the exact local commit", async () => {
  const f = await fixture(); await importModuleGitBundle({ ...f.target, ...f.bundle });
  const fork = await commitModuleSource({ ...f.target, versionId: "fork", files: [...initial, file("local.txt", "custom")], message: "Local customization" });
  const candidate = await mergeModuleUpstream({ ...f.target, versionId: "included", upstreamCommit: f.release.commit });
  expect(candidate.commit).toBe(fork.commit);
  expect(await getModuleLocalHead(f.target)).toBe(fork.commit);
  expect(git(moduleGitPath(f.platform, f.target.moduleId), ["rev-parse", "refs/chrona/candidates/included"])).toBe(fork.commit);
});
test("merge conflicts preserve local branch and upstream evidence", async () => {
  const f = await fixture(); await importModuleGitBundle({ ...f.target, ...f.bundle });
  const fork = await commitModuleSource({ ...f.target, versionId: "fork", files: [initial[0]!, file("base.txt", "local\n")], message: "Local edit" });
  const upstream = await commitModuleSource({ ...f.source, versionId: "update", files: [initial[0]!, file("base.txt", "upstream\n")], message: "Upstream edit" });
  git(f.repo, ["update-ref", "refs/heads/main", upstream.commit]);
  const bundlePath = join(f.platform, "update.bundle"); git(f.repo, ["bundle", "create", bundlePath, "refs/heads/main"]);
  await importModuleGitBundle({ ...f.target, ...f.bundle, bundlePath, commit: upstream.commit });
  await expect(mergeModuleUpstream({ ...f.target, versionId: "conflict", upstreamCommit: upstream.commit })).rejects.toThrow("conflicts");
  expect(await getModuleLocalHead(f.target)).toBe(fork.commit);
  expect(git(moduleGitPath(f.platform, f.target.moduleId), ["rev-parse", `refs/chrona/upstream/${upstream.commit}`])).toBe(upstream.commit);
});
test.each(["file:///tmp/repo", "https://user:secret@github.com/owner/repo", "http://github.com/owner/repo", "https://github.com/owner/repo?token=secret", "https://example.com/owner/repo"])("rejects non-public upstream %s", async repository => {
  const f = await fixture();
  await expect(fetchModuleUpstream({ ...f.target, repository, branch: "main" })).rejects.toMatchObject({ code: "invalid" });
});

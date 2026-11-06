import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { StewardError } from "./errors";
import { ensureModuleGit, getModuleLocalHead, moduleGitCommand as git, moduleGitRevision as revision, pinModuleGitRef as pin, readModuleSource, type ModuleGitFile, type ModuleGitRevision } from "./module-git";

type Repository = { platform: string; moduleId: string };
type Bundle = { bundlePath: string; commit: string; branch: string; repository: string | null };
type SourceRevision = ModuleGitRevision & { files: ModuleGitFile[] };
const zero = "0".repeat(40);
function publicRepository(repository: string) {
  let url: URL;
  try { url = new URL(repository); } catch { throw new StewardError("invalid", "Invalid public module repository"); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(url.pathname)) throw new StewardError("invalid", "Module upstream must be a public HTTPS GitHub repository");
  return repository;
}
async function branchRef(repo: string, branch: string) {
  const ref = `refs/heads/${branch}`;
  await git(repo, ["check-ref-format", ref]);
  return ref;
}
async function configureUpstream(repo: string, repository: string, branch: string) {
  await git(repo, ["config", "--local", "remote.upstream.url", repository]);
  await git(repo, ["config", "--local", "remote.upstream.fetch", `+refs/heads/${branch}:refs/remotes/upstream/${branch}`]);
}
export async function importModuleGitBundle(input: Repository & Bundle): Promise<ModuleGitRevision> {
  if (!/^[a-f0-9]{40}$/.test(input.commit)) throw new StewardError("invalid", "Invalid module release commit");
  if (input.repository !== null) publicRepository(input.repository);
  const bundle = resolve(input.bundlePath), stat = await lstat(bundle);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(bundle) !== bundle) throw new StewardError("forbidden", "Unsafe module Git bundle");
  const repo = await ensureModuleGit(input.platform, input.moduleId), source = await branchRef(repo, input.branch);
  // verifyModuleGitBundle calls this in an empty repo to reject missing prerequisite history.
  const heads = (await git(repo, ["bundle", "list-heads", bundle, source])).toString().trim();
  if (heads !== `${input.commit} ${source}`) throw new StewardError("conflict", "Module bundle branch does not match the release commit");
  await git(repo, ["bundle", "verify", bundle]);
  await git(repo, ["-c", "protocol.allow=never", "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-write-fetch-head", bundle, source]);
  const result = await revision(repo, input.commit);
  await readModuleSource({ ...input, commit: result.commit });
  await pin(repo, `refs/chrona/releases/${result.commit}`, result.commit);
  if (input.repository !== null) {
    await configureUpstream(repo, input.repository, input.branch);
    const remoteRef = `refs/remotes/upstream/${input.branch}`;
    const existing = (await git(repo, ["for-each-ref", "--format=%(objectname)", remoteRef])).toString().trim();
    if (!existing) await git(repo, ["update-ref", remoteRef, result.commit, zero]);
  }
  if (!await getModuleLocalHead(input)) await git(repo, ["update-ref", "refs/heads/local", result.commit, zero]);
  return result;
}
export async function verifyModuleGitBundle(input: Omit<Bundle, "repository"> & { repository?: string | null }): Promise<SourceRevision> {
  const platform = await mkdtemp(join(tmpdir(), "chrona-module-bundle-"));
  try {
    const location = { platform, moduleId: "verify" };
    const result = await importModuleGitBundle({ ...input, ...location, repository: input.repository ?? null });
    return { ...result, files: await readModuleSource({ ...location, commit: result.commit }) };
  } finally { await rm(platform, { recursive: true, force: true }); }
}
export async function getModuleUpstreamHead(input: Repository & { branch: string }): Promise<string | undefined> {
  const repo = await ensureModuleGit(input.platform, input.moduleId);
  await branchRef(repo, input.branch);
  return (await git(repo, ["for-each-ref", "--format=%(objectname)", `refs/remotes/upstream/${input.branch}`])).toString().trim() || undefined;
}
export async function fetchModuleUpstream(input: Repository & { repository: string; branch: string }): Promise<ModuleGitRevision> {
  const repository = publicRepository(input.repository), repo = await ensureModuleGit(input.platform, input.moduleId);
  const source = await branchRef(repo, input.branch), target = `refs/remotes/upstream/${input.branch}`;
  await git(repo, ["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "fetch", "--no-tags", "--no-write-fetch-head", repository, `+${source}:${target}`]);
  const commit = (await git(repo, ["rev-parse", "--verify", `${target}^{commit}`])).toString().trim();
  await pin(repo, `refs/chrona/upstream/${commit}`, commit);
  await configureUpstream(repo, repository, input.branch);
  return revision(repo, commit);
}
async function isAncestor(repo: string, ancestor: string, descendant: string) {
  try { await git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]); return true; }
  catch (error) {
    if (error instanceof StewardError && "exitCode" in error && error.exitCode === 1) return false;
    throw error;
  }
}
export async function mergeModuleUpstream(input: Repository & { versionId: string; upstreamCommit: string }): Promise<SourceRevision> {
  if (!/^[a-zA-Z0-9_-]+$/.test(input.versionId)) throw new StewardError("invalid", "Invalid module source version");
  const repo = await ensureModuleGit(input.platform, input.moduleId), local = await getModuleLocalHead(input);
  if (!local) throw new StewardError("conflict", "Module has no local source to merge");
  const upstream = await revision(repo, input.upstreamCommit);
  await pin(repo, `refs/chrona/upstream/${upstream.commit}`, upstream.commit);
  let commit = local;
  if (local !== upstream.commit) {
    if (await isAncestor(repo, local, upstream.commit)) commit = upstream.commit;
    else if (!await isAncestor(repo, upstream.commit, local)) {
      let tree: string;
      try { tree = (await git(repo, ["merge-tree", "--write-tree", local, upstream.commit])).toString().split("\n")[0]!; }
      catch { throw new StewardError("conflict", "Upstream merge has conflicts or no common history; local source was preserved"); }
      commit = (await git(repo, ["commit-tree", tree, "-p", local, "-p", upstream.commit], Buffer.from("Merge module upstream\n"))).toString().trim();
    }
  }
  const result = await revision(repo, commit), files = await readModuleSource({ ...input, commit });
  await pin(repo, `refs/chrona/candidates/${input.versionId}`, result.commit);
  return { ...result, files };
}

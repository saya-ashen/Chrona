import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { getChronaDataDir } from "./start-server";

export type ModuleGitRequest = { action: "status"; module: string } | { action: "associate"; module: string; repository: string; branch: string } | { action: "push"; module: string; commit: string; expectedRemote: string };
type Options = { dataDir?: string; databaseUrl?: string };
/** Only tests inject transport; the CLI always uses validated GitHub HTTPS and gh. */
export type ModuleGitTransport = { repository: (repository: string) => string; protocol: "file"; timeoutMs?: number };
const oid = /^[a-f0-9]{40}(?![\s\S])/;
const zero = "0".repeat(40);
class GitFailure extends Error {
  constructor(readonly exitCode?: number) { super("Module Git operation failed (remote diagnostics withheld)"); }
}
function git(repo: string, args: string[], network?: ModuleGitTransport | true): Promise<string> {
  // In particular ignore inherited GIT_CONFIG_*, GIT_TRACE*, object paths and askpass.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|GH_DEBUG$|GH_HOST$|SSH_)/.test(key)));
  const settings = ["core.hooksPath=/dev/null", "maintenance.auto=false", "gc.auto=0", "credential.helper=", "core.askPass=", "http.extraHeader=", "http.followRedirects=false", "protocol.allow=never"];
  if (network) settings.push(`protocol.${network === true ? "https" : network.protocol}.allow=always`);
  if (network === true) settings.push("credential.https://github.com.helper=!gh auth git-credential");
  return new Promise((accept, reject) => {
    execFile("git", ["--no-replace-objects", ...settings.flatMap(value => ["-c", value]), "--git-dir", repo, ...args], {
      env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_GRAFT_FILE: "/dev/null", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
      encoding: "utf8", timeout: network && network !== true ? network.timeoutMs ?? 30_000 : 30_000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => error ? reject(new GitFailure(typeof error.code === "number" ? error.code : undefined)) : accept(stdout));
  });
}
function repositoryUrl(value: string) {
  // Validate the spelling too: URL parsing alone normalizes traversal and escapes.
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)$/.exec(value);
  if (!match || match[0] !== value || [match[1], match[2]].some(part => part === "." || part === "..")) throw new Error("Repository must be an HTTPS GitHub repository without credentials, query or fragment");
  const name = match[2]!.replace(/\.git$/, "");
  if (!name) throw new Error("Invalid GitHub repository");
  return `https://github.com/${match[1]}/${name}.git`;
}
async function safePath(path: string, directory: boolean) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || await realpath(path) !== resolve(path)) throw new Error("Unsafe module Git repository path");
}
async function existingRepository(dataDir: string, moduleId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(moduleId)) throw new Error("Invalid module repository identity");
  const platform = join(resolve(dataDir), "platform"), repos = join(platform, "repos"), repo = join(repos, `${moduleId}.git`);
  for (const path of [platform, repos, repo, join(repo, "objects"), join(repo, "refs")]) await safePath(path, true);
  for (const name of ["HEAD", "config"]) await safePath(join(repo, name), false);
  await checkConfig(repo);
  if ((await git(repo, ["rev-parse", "--is-bare-repository"])).trim() !== "true") throw new Error("Module source must be an existing bare repository");
  return repo;
}
async function checkConfig(repo: string) {
  // Reject local executable/transport overrides and includes before any repository operation.
  const entries = (await git(repo, ["config", "--local", "--no-includes", "--null", "--list"])).split("\0").filter(Boolean);
  const allowed = /^(core\.(repositoryformatversion|filemode|bare|logallrefupdates)|remote\.[\w-]+\.(url|fetch)|branch\.[\w/.-]+\.(remote|merge))$/;
  for (const entry of entries) if (!allowed.test(entry.slice(0, entry.indexOf("\n")))) throw new Error("Unsupported local Git configuration; remove overrides before owner Git administration");
}
async function refHead(repo: string, ref: string) {
  const entries = (await git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", ref])).trim().split("\n");
  return entries.find(entry => entry.startsWith(`${ref} `))?.slice(ref.length + 1) ?? null;
}
async function ancestor(repo: string, from: string, to: string) {
  try { await git(repo, ["merge-base", "--is-ancestor", from, to]); return true; }
  catch (error) { if (error instanceof GitFailure && error.exitCode === 1) return false; throw error; }
}
async function branchRef(repo: string, branch: string) {
  if (!branch || branch.startsWith("-") || branch.length > 200) throw new Error("Invalid upstream branch");
  const ref = `refs/heads/${branch}`;
  try { await git(repo, ["check-ref-format", ref]); } catch { throw new Error("Invalid upstream branch"); }
  return ref;
}
async function configValues(repo: string, key: string) {
  try { return (await git(repo, ["config", "--local", "--null", "--get-all", key])).split("\0").filter(Boolean); }
  catch (error) { if (error instanceof GitFailure && error.exitCode === 1) return []; throw error; }
}
async function checkSource(repo: string, prior: { repository: string | null; branch: string } | null, repository: string, branch: string) {
  if (prior?.repository && (repositoryUrl(prior.repository) !== repository || prior.branch !== branch)) throw new Error("Conflicting prior upstream source; replacement is not supported");
  const urls = await configValues(repo, "remote.upstream.url");
  const fetches = await configValues(repo, "remote.upstream.fetch");
  if (urls.length > 1 || urls.some(url => repositoryUrl(url) !== repository) || fetches.length > 1 || fetches.some(ref => ref !== `+refs/heads/${branch}:refs/remotes/upstream/${branch}`)) throw new Error("Conflicting configured upstream source");
}
async function fetched<T>(repo: string, repository: string, source: string, transport: ModuleGitTransport | undefined, use: (commit: string) => Promise<T>) {
  const temporary = `refs/chrona/admin/${randomUUID()}`;
  try {
    await git(repo, ["fetch", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--", transport ? transport.repository(repository) : repository, `${source}:${temporary}`], transport ?? true);
    const commit = (await git(repo, ["rev-parse", "--verify", `${temporary}^{commit}`])).trim();
    if (!oid.test(commit)) throw new Error("Invalid fetched commit");
    return await use(commit);
  } finally { await git(repo, ["update-ref", "-d", temporary]); }
}
async function observedRemote(repo: string, repository: string, source: string, transport?: ModuleGitTransport) {
  const output = (await git(repo, ["ls-remote", "--refs", "--", transport ? transport.repository(repository) : repository, source], transport ?? true)).trim();
  const [commit, ref] = output.split(/\s+/);
  if (!commit || !oid.test(commit) || ref !== source || output.includes("\n")) throw new Error("Remote branch could not be confirmed");
  return commit;
}
type Context = { db: PrismaClient; repo: string; moduleId: string; transport?: ModuleGitTransport };
async function associate(context: Context, repository: string, branch: string, commit: string) {
  const { db, repo, moduleId } = context;
  const config = join(repo, "config"), temporary = join(repo, `config.admin-${randomUUID()}`), previous = await readFile(config);
  const ref = `refs/remotes/upstream/${branch}`, previousHead = await refHead(repo, ref);
  await writeFile(temporary, previous, { flag: "wx", mode: 0o600 });
  const state = { installed: false };
  try {
    await git(repo, ["config", "--file", temporary, "--replace-all", "remote.upstream.url", repository]);
    await git(repo, ["config", "--file", temporary, "--replace-all", "remote.upstream.fetch", `+refs/heads/${branch}:${ref}`]);
    await db.$transaction(async tx => {
      await tx.moduleUpstream.upsert({ where: { moduleId }, create: { moduleId, repository, branch, commit }, update: { repository, branch, commit } });
      await tx.audit.create({ data: { workspaceId: "ws_default", actorKey: "user", kind: "admin_git_associate", subjectId: moduleId, details: { source: "cli", repository, branch, commit } } });
      await rename(temporary, config); state.installed = true;
      await git(repo, ["update-ref", ref, commit, previousHead ?? zero]);
    });
  } catch (error) {
    if (state.installed) {
      await writeFile(temporary, previous, { mode: 0o600 });
      await rename(temporary, config);
      if (previousHead) await git(repo, ["update-ref", ref, previousHead]);
      else await git(repo, ["update-ref", "-d", ref]);
    }
    throw error;
  } finally { await rm(temporary, { force: true }); }
  return { status: "associated", moduleId, repository, branch, fetchedCommit: commit };
}
async function push(context: Context, repository: string, source: string, commit: string, expectedRemote: string) {
  const { db, repo, moduleId, transport } = context;
  const details = { source: "cli", repository, branch: source.slice("refs/heads/".length), commit, expectedRemote };
  await db.audit.create({ data: { workspaceId: "ws_default", actorKey: "user", kind: "admin_git_push_requested", subjectId: moduleId, details } });
  // A normal push checks the server's current tip and cannot discard concurrent commits.
  // Never retry: any transport error may follow a successful remote update.
  let pushFailed = false;
  try { await git(repo, ["push", "--porcelain", "--no-verify", "--no-follow-tags", "--recurse-submodules=no", "--", transport ? transport.repository(repository) : repository, `${commit}:${source}`], transport ?? true); }
  catch { pushFailed = true; }
  let observed: string | null = null;
  try { observed = await observedRemote(repo, repository, source, transport); } catch { /* Preserve uncertainty without exposing remote output. */ }
  const status = observed === commit ? "pushed" : "uncertain";
  const result = { status, moduleId, ...details, observedRemote: observed, pushFailed };
  await db.audit.create({ data: { workspaceId: "ws_default", actorKey: "user", kind: "admin_git_push_result", subjectId: moduleId, details: result } });
  return result;
}
type Upstream = { repository: string | null; branch: string; commit: string } | null;
type Mutation = Exclude<ModuleGitRequest, { action: "status" }>;
async function localStatus(context: Context, prior: Upstream, activeHash: string | null, localCommit: string | null) {
  const { repo, moduleId } = context;
  const repository = prior?.repository ? repositoryUrl(prior.repository) : null;
  if (repository) await checkSource(repo, prior, repository, prior!.branch);
  const branch = prior ? await branchRef(repo, prior.branch) : null;
  return { status: "local", moduleId, activeHash, localCommit, repository, branch: prior?.branch ?? null, recordedCommit: prior?.commit ?? null, fetchedCommit: branch ? await refHead(repo, `refs/remotes/upstream/${prior!.branch}`) : null, remoteChecked: false };
}
function selectedSource(request: Mutation, prior: Upstream) {
  if (request.action === "associate") return { repository: repositoryUrl(request.repository), branch: request.branch };
  if (!prior?.repository) throw new Error("Module upstream is not associated");
  return { repository: repositoryUrl(prior.repository), branch: prior.branch };
}
async function mutate(context: Context, request: Mutation, prior: Upstream, localCommit: string) {
  const { repo, transport } = context, { repository, branch } = selectedSource(request, prior);
  const source = await branchRef(repo, branch);
  await checkSource(repo, prior, repository, branch);
  if (request.action === "push") {
    if (!oid.test(request.commit) || !oid.test(request.expectedRemote)) throw new Error("Push requires exact lowercase 40-character commit and expected remote SHA");
    if (!await ancestor(repo, request.commit, localCommit)) throw new Error("Selected commit is not reachable from local source history");
  }
  return fetched(repo, repository, source, transport, async remoteCommit => {
    if (request.action === "associate") {
      try { await git(repo, ["merge-base", localCommit, remoteCommit]); } catch { throw new Error("Repository has no shared history with local source"); }
      return associate(context, repository, branch, remoteCommit);
    }
    if (remoteCommit !== request.expectedRemote) throw new Error("Remote changed; inspect the remote and supply its current SHA explicitly");
    if (!await ancestor(repo, remoteCommit, request.commit)) throw new Error("Push would not fast-forward the remote branch");
    return push(context, repository, source, request.commit, request.expectedRemote);
  });
}
async function execute(db: PrismaClient, dataDir: string, request: ModuleGitRequest, transport?: ModuleGitTransport) {
  if (!request.module) throw new Error("Module name or id is required");
  const module = await db.module.findFirst({ where: { workspaceId: "ws_default", OR: [{ id: request.module }, { name: request.module }] } });
  if (!module) throw new Error("Module not found");
  const repo = await existingRepository(dataDir, module.id), context = { db, repo, moduleId: module.id, transport };
  const prior = await db.moduleUpstream.findUnique({ where: { moduleId: module.id } });
  const localCommit = await refHead(repo, "refs/heads/local");
  if (request.action === "status") return localStatus(context, prior, module.activeHash, localCommit);
  if (!localCommit || !oid.test(localCommit)) throw new Error("Module has no local source history");
  return mutate(context, request, prior, localCommit);
}
/** Local filesystem ownership authorizes this CLI only; no Provider or kernel API is involved. */
export async function runAdminModuleGit(request: ModuleGitRequest, options: Options = {}, transport?: ModuleGitTransport) {
  const dataDir = options.dataDir ?? getChronaDataDir(), databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? `file:${join(dataDir, "chrona.db")}`;
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || !existsSync(path)) throw new Error("Chrona database not found. Start Chrona once before using chrona admin.");
  const lock = request.action === "status" ? undefined : acquireSqliteRuntimeLock(databaseUrl);
  try {
    const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
    try {
      const result = await execute(db, dataDir, request, transport);
      console.log(JSON.stringify(result, null, 2));
      return result;
    } finally { await db.$disconnect(); }
  } finally { lock?.release(); }
}

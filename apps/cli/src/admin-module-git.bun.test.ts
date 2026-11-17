import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { runAdminModuleGit, type ModuleGitTransport } from "./admin-module-git";
import { createProgram } from "./program";

const fixtures: { db: PrismaClient; dataDir: string }[] = [];
const log = spyOn(console, "log").mockImplementation(() => {});
afterAll(() => { log.mockRestore(); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) { await f.db.$disconnect(); rmSync(f.dataDir, { recursive: true, force: true }); }
  log.mockClear();
});
const url = "https://github.com/chrona-core/test-module.git";
function git(repo: string, args: string[], input?: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return execFileSync("git", ["-c", "protocol.file.allow=always", "--git-dir", repo, ...args], { input, encoding: "utf8", env: { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@localhost", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@localhost" }, stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function commit(repo: string, message: string, parent?: string) {
  const tree = git(repo, ["mktree"], "");
  return git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], `${message}\n`);
}
async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "chrona-owner-git-")), databaseUrl = `file:${join(dataDir, "chrona.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve("prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) }); fixtures.push({ db, dataDir });
  await db.workspace.create({ data: { id: "ws_default", name: "Personal" } });
  const module = await db.module.create({ data: { workspaceId: "ws_default", name: "test-module" } });
  const repo = join(dataDir, "platform", "repos", `${module.id}.git`), remote = join(dataDir, "remote.git");
  mkdirSync(repo, { recursive: true }); mkdirSync(remote);
  for (const path of [repo, remote]) git(path, ["init", "--bare", "--object-format=sha1", "--template=", "--initial-branch=local"]);
  const base = commit(repo, "shared"), selected = commit(repo, "selected", base), tip = commit(repo, "later unselected", selected);
  git(repo, ["update-ref", "refs/heads/local", tip]);
  git(repo, ["update-ref", "refs/chrona/candidates/source", selected]);
  git(remote, ["fetch", "--no-tags", repo, `${base}:refs/heads/main`]);
  await db.module.update({ where: { id: module.id }, data: { activeHash: base } });
  const options = { dataDir, databaseUrl }, transport: ModuleGitTransport = { protocol: "file", repository: () => remote };
  const associate = (branch = "main", repository = url) => runAdminModuleGit({ action: "associate", module: module.name, repository, branch }, options, transport);
  const push = (sha = selected, expectedRemote = base, injected = transport) => runAdminModuleGit({ action: "push", module: module.id, commit: sha, expectedRemote }, options, injected);
  return { db, module, repo, remote, base, selected, tip, dataDir, options, transport, associate, push };
}
function refs(repo: string) { return git(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]); }

test("association verifies real shared history, persists atomically, and never changes local/active or pushes", async () => {
  const f = await fixture(), before = refs(f.repo);
  expect(await runAdminModuleGit({ action: "status", module: f.module.id }, f.options, f.transport)).toMatchObject({ localCommit: f.tip, repository: null, fetchedCommit: null, remoteChecked: false });
  expect(await f.associate("main", url.slice(0, -4))).toMatchObject({ status: "associated", repository: url, fetchedCommit: f.base });
  expect(await f.db.moduleUpstream.findUniqueOrThrow({ where: { moduleId: f.module.id } })).toMatchObject({ repository: url, branch: "main", commit: f.base });
  expect(git(f.repo, ["config", "--get", "remote.upstream.url"])).toBe(url);
  expect(git(f.repo, ["config", "--get", "remote.upstream.fetch"])).toBe("+refs/heads/main:refs/remotes/upstream/main");
  expect(refs(f.repo).split("\n").filter(ref => !ref.startsWith("refs/remotes/" )).join("\n")).toBe(before);
  expect(git(f.remote, ["rev-parse", "refs/heads/main"])).toBe(f.base);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: f.base });
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "admin_git_associate" } })).toMatchObject({ actorKey: "user", details: { source: "cli", repository: url } });
  expect(existsSync(join(f.repo, "FETCH_HEAD"))).toBe(false);
  await f.associate();
});

test("explicit push selects an ancestor of local tip exactly and confirms the remote without activation", async () => {
  const f = await fixture(); await f.associate(); const before = refs(f.repo);
  expect(await f.push()).toMatchObject({ status: "pushed", commit: f.selected, observedRemote: f.selected, pushFailed: false });
  expect(git(f.remote, ["rev-parse", "refs/heads/main"])).toBe(f.selected);
  expect(git(f.repo, ["rev-parse", "refs/heads/local"])).toBe(f.tip);
  expect(refs(f.repo)).toBe(before);
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ activeHash: f.base });
  expect(await f.db.audit.count({ where: { kind: "admin_git_push_requested" } })).toBe(1);
  expect(await f.db.audit.findFirstOrThrow({ where: { kind: "admin_git_push_result" } })).toMatchObject({ details: { status: "pushed", expectedRemote: f.base, observedRemote: f.selected } });
  expect(await f.db.run.count()).toBe(0);
});

test("status works under runtime lock, mutations refuse it, and locks release after failures", async () => {
  const f = await fixture(), lock = acquireSqliteRuntimeLock(f.options.databaseUrl);
  try {
    await runAdminModuleGit({ action: "status", module: f.module.name }, f.options, f.transport);
    await expect(f.associate()).rejects.toThrow("already in use");
    await expect(f.push()).rejects.toThrow("already in use");
  } finally { lock.release(); }
  await expect(f.associate("missing")).rejects.toThrow("diagnostics withheld");
  const released = acquireSqliteRuntimeLock(f.options.databaseUrl); released.release();
});

test("failed fetch, nonexistent branch and unrelated history leave configuration, persistence and refs untouched", async () => {
  const f = await fixture(), before = refs(f.repo), config = readFileSync(join(f.repo, "config"), "utf8");
  await expect(f.associate("missing")).rejects.toThrow("diagnostics withheld");
  const unrelated = commit(f.remote, "unrelated"); git(f.remote, ["update-ref", "refs/heads/main", unrelated]);
  // A repository-local graft must not manufacture a shared ancestor.
  mkdirSync(join(f.repo, "info"), { recursive: true });
  writeFileSync(join(f.repo, "info", "grafts"), `${unrelated} ${f.base}\n`);
  await expect(f.associate()).rejects.toThrow("no shared history");
  expect(refs(f.repo)).toBe(before); expect(readFileSync(join(f.repo, "config"), "utf8")).toBe(config);
  expect(await f.db.moduleUpstream.count()).toBe(0); expect(await f.db.audit.count()).toBe(0);
});

test("database refusal rolls back both Git config and tracking ref", async () => {
  const f = await fixture(), before = refs(f.repo), config = readFileSync(join(f.repo, "config"), "utf8");
  await f.db.$executeRawUnsafe("CREATE TRIGGER reject_associate BEFORE INSERT ON Audit BEGIN SELECT RAISE(ABORT, 'test audit refusal'); END");
  await expect(f.associate()).rejects.toThrow();
  expect(await f.db.moduleUpstream.count()).toBe(0); expect(refs(f.repo)).toBe(before);
  expect(readFileSync(join(f.repo, "config"), "utf8")).toBe(config);
});

test("rejects changed expected SHA and non-fast-forward history before a push", async () => {
  const f = await fixture(); await f.associate();
  await expect(f.push(f.selected, "a".repeat(40))).rejects.toThrow("Remote changed");
  const other = commit(f.remote, "remote divergence", f.base); git(f.remote, ["update-ref", "refs/heads/main", other]);
  await expect(f.push(f.selected, other)).rejects.toThrow("not fast-forward");
  expect(git(f.remote, ["rev-parse", "refs/heads/main"])).toBe(other);
  expect(await f.db.audit.count({ where: { kind: "admin_git_push_requested" } })).toBe(0);
});

test("a concurrent remote advancement between fetch and push cannot be overwritten", async () => {
  const f = await fixture(); await f.associate();
  const other = commit(f.remote, "concurrent update", f.base); let calls = 0;
  const transport: ModuleGitTransport = { protocol: "file", repository: () => {
    if (++calls === 2) git(f.remote, ["update-ref", "refs/heads/main", other]);
    return f.remote;
  } };
  expect(await f.push(f.selected, f.base, transport)).toMatchObject({ status: "uncertain", pushFailed: true, observedRemote: other });
  expect(git(f.remote, ["rev-parse", "refs/heads/main"])).toBe(other); expect(calls).toBe(3);
});

test("loss of confirmation remains uncertain and never retries the push", async () => {
  const f = await fixture(); await f.associate(); let calls = 0;
  const transport: ModuleGitTransport = { protocol: "file", repository: () => {
    if (++calls === 3) throw new Error("private remote diagnostic token=not-for-output");
    return f.remote;
  } };
  expect(await f.push(f.selected, f.base, transport)).toMatchObject({ status: "uncertain", pushFailed: false, observedRemote: null });
  expect(git(f.remote, ["rev-parse", "refs/heads/main"])).toBe(f.selected); expect(calls).toBe(3);
  expect(JSON.stringify(log.mock.calls)).not.toContain("not-for-output");
  expect(JSON.stringify(await f.db.audit.findMany())).not.toContain("not-for-output");
});

test("a timeout after the remote update is confirmed by observing the exact SHA", async () => {
  const f = await fixture(); await f.associate();
  const binary = execFileSync("which", ["git"], { encoding: "utf8" }).trim(), bin = join(f.dataDir, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh\n'${binary}' "$@"\nresult=$?\ncase " $* " in *" push "*) sleep 1;; esac\nexit "$result"\n`); chmodSync(join(bin, "git"), 0o700);
  const previous = process.env.PATH; process.env.PATH = `${bin}:${previous}`;
  try {
    expect(await f.push(f.selected, f.base, { ...f.transport, timeoutMs: 150 })).toMatchObject({ status: "pushed", pushFailed: true, observedRemote: f.selected });
  } finally { process.env.PATH = previous; }
});

test("invalid URLs, refs, exact SHAs, dangling objects and remote-only commits are refused", async () => {
  const f = await fixture();
  for (const repository of ["http://github.com/a/b", "https://other.com/a/b", "https://user:secret@github.com/a/b", "https://github.com/a/b?token=private", "https://github.com/a/b#main", "https://github.com:443/a/b", "https://github.com/a/../b", "https://github.com/a/%62", "/tmp/local.git", "git@github.com:a/b", "https://github.com/a/b\n"]) await expect(f.associate("main", repository)).rejects.toThrow("HTTPS GitHub");
  for (const branch of ["-main", "../main", "main:other", "main..other", "main\n", "main@{0}"]) await expect(f.associate(branch)).rejects.toThrow("Invalid upstream branch");
  await f.associate();
  for (const sha of ["HEAD", f.selected.toUpperCase(), `${f.selected}\n`, "a".repeat(39), "a".repeat(41)]) await expect(f.push(sha)).rejects.toThrow("exact lowercase");
  const dangling = commit(f.repo, "unreachable", f.base);
  await expect(f.push(dangling)).rejects.toThrow("not reachable");
  const remoteOnly = commit(f.remote, "remote only", f.base); git(f.remote, ["update-ref", "refs/heads/main", remoteOnly]);
  await expect(f.push(remoteOnly, remoteOnly)).rejects.toThrow();
  expect(await f.db.audit.count({ where: { kind: "admin_git_push_requested" } })).toBe(0);
});

test("prior repository or branch conflicts are rejected before network access", async () => {
  const f = await fixture(); await f.associate();
  await expect(f.associate("main", "https://github.com/other/repository.git")).rejects.toThrow("Conflicting prior");
  await expect(f.associate("other")).rejects.toThrow("Conflicting prior");
  git(f.repo, ["config", "remote.upstream.url", "https://github.com/other/repository.git"]);
  await expect(f.associate()).rejects.toThrow("Conflicting configured");
});

test("local config includes, executable overrides and symlink repositories are refused", async () => {
  const f = await fixture();
  for (const key of ["include.path", "credential.helper", "core.sshCommand", "url.https://evil.invalid/.insteadOf", "remote.upstream.pushurl", "http.followRedirects"]) {
    git(f.repo, ["config", key, "untrusted"]);
    await expect(f.associate()).rejects.toThrow("Unsupported local Git configuration");
    git(f.repo, ["config", "--unset", key]);
  }
  const saved = join(f.dataDir, "saved.git"); execFileSync("mv", [f.repo, saved]); symlinkSync(saved, f.repo);
  await expect(f.associate()).rejects.toThrow("Unsafe module Git repository path");
});

test("Git environment, global config and local hooks cannot override owner operations", async () => {
  const f = await fixture(), marker = join(f.dataDir, "hook-ran"), hooks = join(f.repo, "hooks"); mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-push"), `#!/bin/sh\ntouch '${marker}'\nexit 1\n`); chmodSync(join(hooks, "pre-push"), 0o700);
  const config = join(f.dataDir, "hostile-global"); writeFileSync(config, '[url "https://bad.invalid/"]\n insteadOf = https://github.com/\n');
  const injected = { GIT_CONFIG_GLOBAL: config, GIT_DIR: "/not-the-module", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "protocol.file.allow", GIT_CONFIG_VALUE_0: "never", GIT_TRACE: join(f.dataDir, "trace") };
  const previous = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]])); Object.assign(process.env, injected);
  try { await f.associate(); expect(await f.push()).toMatchObject({ status: "pushed" }); }
  finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  expect(existsSync(marker)).toBe(false); expect(existsSync(injected.GIT_TRACE)).toBe(false);
});

test("workspace identity and missing source history fail closed without changing builtin activation", async () => {
  const f = await fixture(); await f.db.workspace.create({ data: { id: "other", name: "Other" } });
  const other = await f.db.module.create({ data: { workspaceId: "other", name: "other-module" } });
  for (const module of [other.id, other.name, "missing"]) await expect(runAdminModuleGit({ action: "status", module }, f.options, f.transport)).rejects.toThrow("Module not found");
  await f.db.module.update({ where: { id: f.module.id }, data: { builtin: true } });
  await f.associate();
  expect(await f.db.module.findUniqueOrThrow({ where: { id: f.module.id } })).toMatchObject({ builtin: true, activeHash: f.base });
  await f.db.module.update({ where: { id: f.module.id }, data: { builtin: false } });
  git(f.repo, ["update-ref", "-d", "refs/heads/local"]);
  expect(await runAdminModuleGit({ action: "status", module: f.module.id }, f.options, f.transport)).toMatchObject({ localCommit: null });
  await expect(f.associate()).rejects.toThrow("no local source history");
  rmSync(f.repo, { recursive: true }); await expect(f.associate()).rejects.toThrow(); expect(existsSync(f.repo)).toBe(false);
});

test("Git command registration requires exact push inputs and defaults association branch to main", () => {
  const admin = createProgram().commands.find(command => command.name() === "admin")!;
  const associate = admin.commands.find(command => command.name() === "git-associate")!, push = admin.commands.find(command => command.name() === "git-push")!;
  expect(associate.options.find(option => option.long === "--branch")!.defaultValue).toBe("main");
  expect(push.options.map(option => [option.long, option.mandatory])).toEqual([["--commit", true], ["--expected-remote", true]]);
  expect(admin.commands.some(command => command.name() === "git-status")).toBe(true);
});

import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDirectoryIdentity, physicalLockIdentity, prepareLockedLocalWorkspace, recoverWorkspaceLocks, verifyLocalSource, workspaceDigest, type WorkspaceLock } from "@chrona/workspaces";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Workspace fixture", "-c", "user.email=workspace@example.invalid", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  if (result.status !== 0) throw new Error(result.stderr || "Fixture Git failed");
  return result.stdout.trim();
}
function fixture(mode: "existing" | "independent_worktree" = "existing") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "chrona-workspaces-test-"))); roots.push(root);
  git(root, ["init", "-q"]); writeFileSync(join(root, "a.txt"), "original"); writeFileSync(join(root, "b.txt"), "second");
  git(root, ["add", "."]); git(root, ["commit", "-qm", "baseline"]);
  const baseline = { kind: "commit" as const, digest: git(root, ["rev-parse", "HEAD"]) };
  const input = {
    binding: { host: "local", owner: "fixture" },
    work: { workId: "work", workspaceRef: "workspace", workspaceMode: mode, baseline },
    mapping: { placement: { kind: "local", project: "repo" }, canonicalPath: root, directoryIdentity: localDirectoryIdentity(root), baseline },
    managedRoot: join(root, "managed"),
  };
  return { root, input };
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("public source verification binds opaque placement, sorted manifest, exact baseline and current bytes", async () => {
  const { root, input } = fixture(), prepared = await prepareLockedLocalWorkspace(input);
  const files = [{ path: "b.txt", sha256: hash("second") }, { path: "a.txt", sha256: hash("original") }];
  const verify = (source = { files }) => verifyLocalSource({ cwd: prepared.cwd, placement: input.mapping.placement, workspace: prepared.workspace, source, now: new Date("2026-01-01T00:00:00Z") });
  try {
    expect(await verify()).toEqual({ placement: input.mapping.placement, baseline: input.work.baseline, manifestDigest: workspaceDigest({ files: [...files].reverse() }), fileCount: 2, verifiedAt: "2026-01-01T00:00:00.000Z", stage: "claim" });
    expect(await verify({ files: [] })).toBeNull();
    writeFileSync(join(root, "a.txt"), "changed");
    await expect(verify()).rejects.toThrow("differs");
    git(root, ["add", "a.txt"]); git(root, ["commit", "-qm", "changed baseline"]);
    await expect(verify({ files: [] })).rejects.toThrow("baseline changed");
  } finally { prepared.release(); }
});

for (const path of ["alias.txt", "../outside.txt"] as const) test(`public source verifier refuses ${path}`, async () => {
  const { root, input } = fixture(), prepared = await prepareLockedLocalWorkspace(input);
  const outside = join(root, "outside.txt"); writeFileSync(outside, "original");
  symlinkSync(join(root, "a.txt"), join(root, "alias.txt"));
  // A subdirectory makes traversal escape real without writing outside the fixture.
  const cwd = path.startsWith("..") ? join(root, "managed") : root;
  try {
    await expect(verifyLocalSource({ cwd, placement: input.mapping.placement, workspace: prepared.workspace, source: { files: [{ path, sha256: hash("original") }] }, now: new Date() })).rejects.toThrow("escapes workspace or uses an alias");
  } finally { prepared.release(); }
});

for (const mode of ["existing", "independent_worktree"] as const) test(`public ${mode} locks require the original owner and persisted token for recovery`, async () => {
  const { input } = fixture(mode), owner = { delivery: "opaque-delivery", launch: "digest" }, recorded: WorkspaceLock[] = [];
  const prepared = await prepareLockedLocalWorkspace(input, { owner, recordLock(lock) { recorded.push(lock); } });
  const locks = join(input.managedRoot, "locks"), names = () => readdirSync(locks).sort();
  const original = names(); expect(original).toHaveLength(mode === "existing" ? 1 : 2);
  await expect(prepareLockedLocalWorkspace(input)).rejects.toThrow();
  recoverWorkspaceLocks(input.managedRoot, { ...owner, delivery: "other" }, recorded); expect(names()).toEqual(original);
  recoverWorkspaceLocks(input.managedRoot, owner, recorded.map(lock => ({ ...lock, token: "0".repeat(64) }))); expect(names()).toEqual(original);
  recoverWorkspaceLocks(input.managedRoot, owner, []); expect(names()).toEqual(original);
  // Simulate a restarted host with independently verified stop; no live release closure is used.
  recoverWorkspaceLocks(input.managedRoot, owner, recorded); expect(names()).toEqual([]);
  const resumed = await prepareLockedLocalWorkspace(input);
  expect(resumed.cwd).toBe(prepared.cwd); resumed.release(); resumed.release(); expect(names()).toEqual([]);
});

test("physical lock prevents a differently bound existing request from adopting an active worktree", async () => {
  const { input } = fixture("independent_worktree"), prepared = await prepareLockedLocalWorkspace(input);
  try {
    await expect(prepareLockedLocalWorkspace({ ...input, binding: { host: "another", owner: "fixture" }, work: { ...input.work, workId: "other", workspaceMode: "existing" }, mapping: { ...input.mapping, canonicalPath: prepared.cwd, directoryIdentity: localDirectoryIdentity(prepared.cwd) } })).rejects.toThrow();
    expect(existsSync(prepared.cwd)).toBe(true);
  } finally { prepared.release(); }
});

test("legacy locks stay held and release refuses changed ownership", async () => {
  const { input } = fixture(), prepared = await prepareLockedLocalWorkspace(input);
  const locks = join(input.managedRoot, "locks"), key = readdirSync(locks)[0]!, path = join(locks, key), token = readFileSync(path, "utf8");
  recoverWorkspaceLocks(input.managedRoot, { host: "local" }, [{ key, token }]); expect(existsSync(path)).toBe(true);
  writeFileSync(path, "replacement-owner"); expect(() => prepared.release()).toThrow("ownership changed"); expect(readFileSync(path, "utf8")).toBe("replacement-owner");
});

for (const change of ["binding", "head", "snapshot", "alias"] as const) test(`preparation rejects changed ${change} and releases only its own lock`, async () => {
  const { root, input } = fixture();
  if (change === "binding") input.mapping.baseline = { ...input.mapping.baseline, digest: "0".repeat(40) };
  if (change === "head") { writeFileSync(join(root, "a.txt"), "next"); git(root, ["add", "a.txt"]); git(root, ["commit", "-qm", "next"]); }
  const request = change === "snapshot" ? { ...input, work: { ...input.work, baseline: { kind: "snapshot" as const, digest: "snapshot" } }, mapping: { ...input.mapping, baseline: { kind: "snapshot" as const, digest: "snapshot" } } } : input;
  if (change === "alias") { const alias = join(root, "alias"); symlinkSync(root, alias); request.mapping.canonicalPath = alias; }
  await expect(prepareLockedLocalWorkspace(request)).rejects.toThrow();
  expect(readdirSync(join(input.managedRoot, "locks"))).toEqual([]);
});

test("failed source check leaves independent workspace retained and safely reusable with the same binding", async () => {
  const { input } = fixture("independent_worktree"), source = { files: [{ path: "a.txt", sha256: hash("original") }] };
  const request = { ...input, work: { ...input.work, source } }, prepared = await prepareLockedLocalWorkspace(request);
  const cwd = prepared.cwd; writeFileSync(join(cwd, "a.txt"), "valuable dirty work"); prepared.release();
  await expect(prepareLockedLocalWorkspace(request)).rejects.toThrow("differs");
  expect(existsSync(cwd)).toBe(true); expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("valuable dirty work");
  expect(readdirSync(join(input.managedRoot, "locks"))).toEqual([]);
  writeFileSync(join(cwd, "a.txt"), "original");
  const retried = await prepareLockedLocalWorkspace(request); expect(retried.cwd).toBe(cwd); retried.release();
});

test("durable unknown creation intent cannot repeat Git worktree add", async () => {
  const { input } = fixture("independent_worktree"), prepared = await prepareLockedLocalWorkspace(input); prepared.release();
  const path = `${prepared.cwd}.json`, record = JSON.parse(readFileSync(path, "utf8")); record.ready = false;
  writeFileSync(path, JSON.stringify(record));
  await expect(prepareLockedLocalWorkspace(input)).rejects.toThrow("creation unknown");
  expect(existsSync(prepared.cwd)).toBe(true); expect(readdirSync(join(input.managedRoot, "locks"))).toEqual([]);
});

test("workspace identity preserves established canonical hashing without a transport dependency", () => {
  const { root } = fixture(), canonicalPath = realpathSync(root);
  // An alias has the same physical identity; authorization additionally requires a canonical mapping.
  const alias = join(root, "alias"); symlinkSync(root, alias);
  expect(localDirectoryIdentity(alias)).toBe(localDirectoryIdentity(canonicalPath));
  expect(physicalLockIdentity(alias)).toBe(physicalLockIdentity(canonicalPath));
  expect(workspaceDigest({ b: [{ z: 1, a: 2 }], a: "binding" })).toBe(hash('{"a":"binding","b":[{"a":2,"z":1}]}'));
});

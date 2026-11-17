import { spawnSync } from "node:child_process";
import { constants, closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, readSync, fstatSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { WorkspaceSource, WorkspaceState, WorkspaceSourceReceipt, LocalWorkspaceInput, WorkspaceLockOptions } from "./types";
import { WORKSPACE_LIMITS } from "./limits";
import { workspaceDigest as localDigest } from "./digest";
import { localDirectoryIdentity, physicalLockIdentity, privateRoot } from "./workspace-identity";

export type VerifiedLocalMapping<Placement = unknown> = LocalWorkspaceInput<Placement>["mapping"];
type WorkBaseline = LocalWorkspaceInput["work"]["baseline"];
type LocalWork = LocalWorkspaceInput["work"];
function git(cwd: string, args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const result = spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8", shell: false, timeout: 5000, maxBuffer: 65_536 });
  if (result.error || result.status !== 0) throw new Error("Workspace Git operation failed");
  return result.stdout.trim();
}

function verifyMapping(mapping: VerifiedLocalMapping) {
  if (!isAbsolute(mapping.canonicalPath) || realpathSync(mapping.canonicalPath) !== mapping.canonicalPath || localDirectoryIdentity(mapping.canonicalPath) !== mapping.directoryIdentity) throw new Error("Workspace physical mapping changed");
}
function verifyBaseline(cwd: string, baseline: WorkBaseline) {
  if (baseline.kind !== "commit") throw new Error("Local workspace requires a verifiable commit baseline");
  if (git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]) !== baseline.digest) throw new Error("Workspace baseline changed");
}
function atomic(path: string, value: unknown) {
  const fd = openSync(`${path}.next`, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(`${path}.next`, path);
  const parent = openSync(dirname(path), "r");
  try { fsyncSync(parent); } finally { closeSync(parent); }
}

function prepareIndependent(mapping: VerifiedLocalMapping, work: LocalWork, cwd: string, metadata: string, expected: unknown) {
    const stat = lstatSync(metadata, { throwIfNoEntry: false });
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 131072) throw new Error("Unsafe workspace ownership record");
      const saved = JSON.parse(readFileSync(metadata, "utf8")) as { expected: unknown; ready: boolean; identity?: string };
      if (localDigest(saved.expected) !== localDigest(expected) || !saved.ready || saved.identity !== localDirectoryIdentity(cwd)) throw new Error("Workspace creation unknown or binding changed");
    } else {
      if (readdirSync(dirname(metadata)).filter(name => name.endsWith(".json")).length >= WORKSPACE_LIMITS.ownershipRecords) throw new Error("Workspace ownership capacity reached");
      if (lstatSync(cwd, { throwIfNoEntry: false })) throw new Error("Workspace destination already exists");
      if (git(mapping.canonicalPath, ["rev-parse", "--verify", `${work.baseline.digest}^{commit}`]) !== work.baseline.digest) throw new Error("Workspace commit unavailable");
      atomic(metadata, { expected, ready: false });
      git(mapping.canonicalPath, ["worktree", "add", "--detach", "--", cwd, work.baseline.digest]);
      verifyBaseline(cwd, work.baseline);
      atomic(metadata, { expected, ready: true, identity: localDirectoryIdentity(cwd), commonDir: git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]), retained: true, retentionProtected: false });
    }
}

/** Local, trusted configuration only. Durable creation intent never retries an uncertain git add. */
export async function prepareLocalWorkspace<Placement>(input: LocalWorkspaceInput<Placement>) {
  const { mapping, work } = input;
  verifyMapping(mapping);
  if (localDigest(work.baseline) !== localDigest(mapping.baseline)) throw new Error("Workspace baseline binding mismatch");
  let cwd = mapping.canonicalPath;
  if (work.workspaceMode === "independent_worktree") {
    privateRoot(input.managedRoot);
    if (work.baseline.kind !== "commit") throw new Error("Independent workspace needs a commit");
    const key = localDigest({ binding: input.binding, workId: work.workId, workspaceRef: work.workspaceRef });
    const metadata = join(input.managedRoot, `${key}.json`);
    cwd = join(input.managedRoot, key);
    const expected = { binding: input.binding, work, mapping, cwd };
    prepareIndependent(mapping, work, cwd, metadata, expected);
  }
  verifyBaseline(cwd, work.baseline);
  const workspace: WorkspaceState<Placement> = { workspaceRef: work.workspaceRef, mode: work.workspaceMode, baseline: work.baseline, state: "ready", sourceReceipt: null, retained: true };
  return { cwd, projectDirectoryIdentity: mapping.directoryIdentity, workspaceDirectoryIdentity: localDirectoryIdentity(cwd), directoryIdentity: localDirectoryIdentity(cwd), workspace };
}

function verifySourceFile(root: string, file: {path: string; sha256: string}) {
    const path = join(root, file.path), canonical = realpathSync(path), within = relative(root, canonical);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within) || canonical !== path) throw new Error("Source path escapes workspace or uses an alias");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) throw new Error("Source manifest requires a regular file");
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536), before = fstatSync(fd);
      let count: number;
      while ((count = readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, count));
      const after = fstatSync(fd);
      if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || hash.digest("hex") !== file.sha256) throw new Error("Source manifest differs from disk");
    } finally { closeSync(fd); }
}

export async function verifyLocalSource<Placement>(input: { cwd: string; placement: Placement; workspace: WorkspaceState<Placement>; source?: WorkspaceSource; now: Date }): Promise<WorkspaceSourceReceipt<Placement> | null> {
  verifyBaseline(input.cwd, input.workspace.baseline);
  if (!input.source?.files.length) return null;
  const root = realpathSync(input.cwd);
  for (const file of input.source.files) {
    verifySourceFile(root, file);
  }
  return { placement: input.placement, baseline: input.workspace.baseline, manifestDigest: localDigest({ files: [...input.source.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }), fileCount: input.source.files.length, verifiedAt: input.now.toISOString(), stage: "claim" };
}

function syncDirectory(path: string) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** A crash leaves a conservative lock; never steal it from PID/timeout guesses. */
export async function prepareLockedLocalWorkspace<Placement>(input: LocalWorkspaceInput<Placement>, options: WorkspaceLockOptions = {}) {
  const { owner, recordLock } = options;
  privateRoot(input.managedRoot);
  const locks = join(input.managedRoot, "locks");
  privateRoot(locks);
  const key = input.work.workspaceMode === "existing" ? localDigest({ physical: physicalLockIdentity(input.mapping.canonicalPath) }) : localDigest({ creating: { binding: input.binding, workId: input.work.workId, workspaceRef: input.work.workspaceRef } });
  const path = join(locks, key), token = localDigest({ key, nonce: crypto.randomUUID() });
  const contents = (key: string) => owner !== undefined ? JSON.stringify({ key, token, owner }) : token;
  const body = contents(key);
  recordLock?.({ key, token });
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(locks);
  let released = false;
  let physical: {path: string; token: string} | null = null;
  const release = () => {
    if (released) return;
    if (readFileSync(path, "utf8") !== body) throw new Error("Workspace lock ownership changed");
    if (physical) {
      if (readFileSync(physical.path, "utf8") !== physical.token) throw new Error("Workspace physical lock ownership changed");
      unlinkSync(physical.path);
    }
    unlinkSync(path); syncDirectory(locks); released = true;
  };
  try {
    const prepared = await prepareLocalWorkspace(input);
    if (input.work.workspaceMode !== "existing") {
      const physicalPath = join(locks, localDigest({ physical: physicalLockIdentity(prepared.cwd) }));
      recordLock?.({ key: physicalPath.slice(locks.length + 1), token });
      const physicalFd = openSync(physicalPath, "wx", 0o600);
      const physicalBody = contents(physicalPath.slice(locks.length + 1));
      try { writeFileSync(physicalFd, physicalBody); fsyncSync(physicalFd); } finally { closeSync(physicalFd); }
      physical = { path: physicalPath, token: physicalBody };
      syncDirectory(locks);
    }
    const sourceReceipt = await verifyLocalSource({ cwd: prepared.cwd, placement: input.mapping.placement, workspace: prepared.workspace, ...(input.work.source ? { source: input.work.source } : {}), now: new Date() });
    return { ...prepared, sourceReceipt, release };
  } catch (error) { release(); throw error; }
}

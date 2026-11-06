import { spawnSync } from "node:child_process";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkCleanupInput, WorkCleanupReceipt } from "@chrona/contracts/steward";
import { localDigest } from "./journal";
import { localDirectoryIdentity, physicalLockIdentity, privateRoot, type LocalWorkspaceInput } from "./workspace-identity";

export type CleanupWorkspace = LocalWorkspaceInput;
type Record = { digest: string; receipt: WorkCleanupReceipt; facts?: string };
function git(cwd: string, args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const result = spawnSync("git", ["--no-optional-locks", "-C", cwd, ...args], { env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
  if (result.error || result.status !== 0) throw new Error("Cleanup Git verification failed");
  return result.stdout.trim();
}
function save(path: string, value: unknown) {
  const fd = openSync(`${path}.next`, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(`${path}.next`, path);
  const parent = openSync(join(path, ".."), "r");
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
function read<T>(path: string): T | null {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 131072) throw new Error("Unsafe cleanup record");
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
// eslint-disable-next-line complexity -- Verify ownership, retention and actual Git state as one deletion precondition.
function inspect(input: CleanupWorkspace, cwd: string, metadata: string) {
  const saved = read<{ expected: CleanupWorkspace & { cwd: string }; ready: boolean; identity: string; commonDir: string; retentionProtected?: boolean }>(metadata);
  if (!saved?.ready || saved.retentionProtected !== false) throw new Error("Workspace retention is protected or unknown");
  const expected = { binding: input.binding, work: input.work, mapping: input.mapping, cwd };
  if (localDigest(saved.expected) !== localDigest(expected)) throw new Error("Workspace ownership binding changed");
  if (realpathSync(cwd) !== cwd || cwd === input.mapping.canonicalPath || localDirectoryIdentity(cwd) !== saved.identity || localDirectoryIdentity(input.mapping.canonicalPath) !== input.mapping.directoryIdentity) throw new Error("Workspace physical identity changed");
  const commonDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDir !== saved.commonDir || commonDir !== git(input.mapping.canonicalPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) throw new Error("Workspace repository identity changed");
  if (git(cwd, ["rev-parse", "--show-toplevel"]) !== cwd || git(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"])) throw new Error("Workspace contains dirty or untracked files");
  const head = git(cwd, ["rev-parse", "HEAD"]), sourceHead = git(input.mapping.canonicalPath, ["rev-parse", "HEAD"]);
  git(input.mapping.canonicalPath, ["merge-base", "--is-ancestor", head, sourceHead]);
  return { identity: saved.identity, commonDir, head, sourceHead, expected };
}
/** Only explicit owner commands reach this local operation; no force, pruning, or source-repository deletion. */
// eslint-disable-next-line complexity, max-statements -- Keep durable intent, physical lock and receipt ordering visible in one operation.
export async function cleanupLocalWorkspace(input: CleanupWorkspace, command: WorkCleanupInput, verify: () => Promise<string>): Promise<WorkCleanupReceipt> {
  const { managedRoot, work } = input;
  if (work.workspaceMode !== "independent_worktree" || command.workId !== work.workId) throw new Error("No owned independent workspace");
  privateRoot(managedRoot);
  const key = localDigest({ binding: input.binding, workId: work.workId, workspaceRef: work.workspaceRef });
  const cwd = join(managedRoot, key), metadata = `${cwd}.json`, receipts = join(managedRoot, "cleanup");
  privateRoot(receipts);
  const path = join(receipts, localDigest({ key, commandKey: command.commandKey })), digest = localDigest(command);
  const old = read<Record>(path);
  if (old) { if (old.digest !== digest) throw new Error("Cleanup command key conflict"); return old.receipt; }
  if (readdirSync(receipts).length >= 2048) throw new Error("Cleanup receipt capacity reached");
  const receipt = (state: WorkCleanupReceipt["state"], reason: string, previewDigest: string | null = null): WorkCleanupReceipt => ({ workId: work.workId, workspaceRef: work.workspaceRef, state, reason, previewDigest });
  const removed = read<WorkCleanupReceipt>(join(receipts, `${key}.removed`));
  if (removed) { const result = receipt("removed", "Workspace already removed"); save(path, { digest, receipt: result }); return result; }
  const intentPath = join(receipts, `${key}.intent`);
  if (read(intentPath)) { const result = receipt("unknown", "Original removal outcome is unknown"); save(path, { digest, receipt: result }); return result; }
  const locks = join(managedRoot, "locks"); privateRoot(locks);
  const held: string[] = [];
  try {
    for (const lock of [localDigest({ creating: { binding: input.binding, workId: work.workId, workspaceRef: work.workspaceRef } }), localDigest({ physical: physicalLockIdentity(cwd) })]) {
      const p = join(locks, lock), fd = openSync(p, "wx", 0o600); held.push(p);
      try { writeFileSync(fd, localDigest(command)); fsyncSync(fd); } finally { closeSync(fd); }
    }
    const facts = await verify(), disk = inspect(input, cwd, metadata), previewDigest = localDigest({ facts, disk });
    if (command.action === "preview") { const result = receipt("retained", "Ready for explicit confirmation", previewDigest); save(path, { digest, facts, receipt: result }); save(join(receipts, `${key}.preview-${previewDigest}`), { digest: previewDigest }); return result; }
    if (!read(join(receipts, `${key}.preview-${command.previewDigest}`)) || command.previewDigest !== previewDigest) throw new Error("Cleanup preview changed");
    if (await verify() !== facts || localDigest(inspect(input, cwd, metadata)) !== localDigest(disk)) throw new Error("Cleanup facts changed before removal");
    // Durable uncertain intent is returned on replay; a lost delete response never repeats deletion.
    const uncertain = receipt("unknown", "Cleanup intent persisted; outcome not yet confirmed", previewDigest);
    save(intentPath, { digest, receipt: uncertain });
    save(path, { digest, receipt: uncertain });
    git(input.mapping.canonicalPath, ["worktree", "remove", "--", cwd]);
    const result = receipt("removed", "Owned stopped workspace removed", previewDigest);
    save(join(receipts, `${key}.removed`), result); save(path, { digest, receipt: result });
    return result;
  } catch {
    const persisted = read<Record>(path);
    if (persisted) return persisted.receipt;
    const result = receipt("blocked", "Workspace cleanup safety checks failed"); save(path, { digest, receipt: result }); return result;
  } finally {
    for (const p of held.reverse()) {
      if (readFileSync(p, "utf8") === localDigest(command)) unlinkSync(p);
    }
  }
}

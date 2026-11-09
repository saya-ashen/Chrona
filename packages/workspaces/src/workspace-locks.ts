import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { workspaceDigest as localDigest } from "./digest";
import { privateRoot } from "./workspace-identity";
import { WORKSPACE_LIMITS } from "./limits";
import type { WorkspaceLock } from "./types";

function readWorkspaceLock(locks: string, name: string) {
  if (!/^[a-f0-9]{64}$/.test(name)) return null;
  const path = join(locks, name), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.size > 4096) throw new Error("Unsafe workspace lock");
  const body = readFileSync(path, "utf8");
  // Legacy random-token locks lack owner evidence and remain held.
  if (!body.startsWith("{")) return null;
  const record = JSON.parse(body) as { owner?: unknown; token?: unknown; key?: unknown };
  if (record.key !== name || typeof record.token !== "string" || !/^[a-f0-9]{64}$/.test(record.token)) throw new Error("Invalid workspace lock");
  return record;
}
function syncDirectory(path: string) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Caller must verify actual stop (or durable never-started evidence) before recovery.
 * Only the original owner and durably recorded key/token pairs can release locks.
 * Unknown and legacy locks remain held.
 */
export function recoverWorkspaceLocks(managedRoot: string, owner: unknown, recorded: readonly WorkspaceLock[]) {
  privateRoot(managedRoot);
  const locks = join(managedRoot, "locks");
  if (!lstatSync(locks, { throwIfNoEntry: false })) return;
  privateRoot(locks);
  const names = readdirSync(locks);
  if (names.length > WORKSPACE_LIMITS.ownershipRecords * 2) throw new Error("Workspace lock capacity reached");
  for (const name of names) {
    const record = readWorkspaceLock(locks, name);
    if (!record) continue;
    if (localDigest(record.owner ?? null) === localDigest(owner) && recorded.some(lock => lock.key === name && lock.token === record.token)) unlinkSync(join(locks, name));
  }
  syncDirectory(locks);
}

import { existsSync, linkSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ensureSqliteParentDir, secureGeneratedPrivateFile, sqlitePathFromFileUrl } from "./sqlite-url";

const LOCK_VERSION = 1;

export type SqliteRuntimeLock = {
  databasePath: string;
  lockPath: string;
  release: () => void;
};

export type RuntimeLockInspection =
  | { state: "missing"; lockPath: string }
  | { state: "malformed"; lockPath: string }
  | { state: "live"; lockPath: string; pid: number }
  | { state: "stale"; lockPath: string; pid: number };

type LockOwner = {
  version: number;
  pid: number;
  createdAt: string;
};

type AcquireSqliteRuntimeLockOptions = {
  /** Test seam; production uses process.kill(pid, 0). */
  isProcessAlive?: (pid: number) => boolean;
  lockPath?: string;
  pid?: number;
};

function databasePath(databaseUrl: string): string {
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || path === ":memory:") {
    throw new Error("Chrona database maintenance requires a persistent SQLite file.");
  }
  return resolve(path);
}

export function sqliteRuntimeLockPath(databaseUrl: string): string {
  return `${databasePath(databaseUrl)}.chrona.lock`;
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM means a real process exists but is owned by another user.
    return code === "EPERM";
  }
}

function readOwner(lockPath: string): LockOwner | null {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<LockOwner>;
    if (
      value.version === LOCK_VERSION
      && typeof value.pid === "number"
      && typeof value.createdAt === "string"
    ) {
      return { version: LOCK_VERSION, pid: value.pid, createdAt: value.createdAt };
    }
  } catch {
    // A torn or foreign lock is stale; the exclusive create below remains the arbiter.
  }
  return null;
}

function publishLock(lockPath: string, owner: LockOwner): void {
  const temporaryPath = `${lockPath}.${owner.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(owner)}\n`, { encoding: "utf8", mode: 0o600 });
    // A generated lock is private on POSIX and receives a verified Windows ACL.
    secureGeneratedPrivateFile(temporaryPath);
    // A hard link publishes a fully-written lock atomically without replacing an owner.
    linkSync(temporaryPath, lockPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

/** Inspects lock ownership without changing it; malformed locks are never auto-repaired. */
export function inspectSqliteRuntimeLock(
  databaseUrl: string,
  options: Pick<AcquireSqliteRuntimeLockOptions, "isProcessAlive" | "lockPath"> = {},
): RuntimeLockInspection {
  const lockPath = options.lockPath ?? sqliteRuntimeLockPath(databaseUrl);
  try { readFileSync(lockPath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing", lockPath };
    return { state: "malformed", lockPath };
  }
  const owner = readOwner(lockPath);
  if (!owner) return { state: "malformed", lockPath };
  return (options.isProcessAlive ?? defaultIsProcessAlive)(owner.pid)
    ? { state: "live", lockPath, pid: owner.pid }
    : { state: "stale", lockPath, pid: owner.pid };
}

/**
 * Quarantines, rather than deletes, a well-formed stale lock. The lock is
 * checked before and after its atomic rename so live or malformed ownership is
 * never removed. The database itself is never touched.
 */
// eslint-disable-next-line complexity -- each branch is a fail-closed lock ownership check.
export function quarantineStaleSqliteRuntimeLock(
  databaseUrl: string,
  options: Pick<AcquireSqliteRuntimeLockOptions, "isProcessAlive" | "lockPath"> = {},
): string | null {
  const inspection = inspectSqliteRuntimeLock(databaseUrl, options);
  if (inspection.state === "missing") return null;
  if (inspection.state === "malformed") throw new Error("Chrona will not repair a malformed database maintenance lock.");
  if (inspection.state === "live") throw new Error("Chrona will not repair a lock owned by a running process.");
  const owner = readOwner(inspection.lockPath);
  if (!owner || owner.pid !== inspection.pid || (options.isProcessAlive ?? defaultIsProcessAlive)(owner.pid)) {
    throw new Error("Chrona lock ownership changed during repair; no lock was moved.");
  }
  const quarantinePath = `${inspection.lockPath}.stale-${owner.pid}-${Date.now()}`;
  renameSync(inspection.lockPath, quarantinePath);
  const moved = readOwner(quarantinePath);
  if (!moved || moved.pid !== owner.pid || (options.isProcessAlive ?? defaultIsProcessAlive)(moved.pid)) {
    // Restore only if our target is still absent; otherwise retain evidence rather than overwrite a new owner.
    if (!existsSync(inspection.lockPath)) renameSync(quarantinePath, inspection.lockPath);
    throw new Error("Chrona lock ownership changed during repair; no lock was quarantined.");
  }
  return quarantinePath;
}

/**
 * Acquires the single-process runtime/maintenance ownership for one SQLite file.
 * Existing locks are never removed automatically: doing so can race a process that
 * has acquired the file but has not yet published its owner metadata.
 */
export function acquireSqliteRuntimeLock(
  databaseUrl: string,
  options: AcquireSqliteRuntimeLockOptions = {},
): SqliteRuntimeLock {
  const path = databasePath(databaseUrl);
  ensureSqliteParentDir(databaseUrl);
  const lockPath = options.lockPath ?? `${path}.chrona.lock`;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const owner = { version: LOCK_VERSION, pid: options.pid ?? process.pid, createdAt: new Date().toISOString() };

  try {
    publishLock(lockPath, owner);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const current = readOwner(lockPath);
    if (!current) {
      throw new Error(
        "Chrona found an incomplete database maintenance lock. Confirm no Chrona process is starting, then remove the lock manually.",
        { cause: error },
      );
    }
    if (isProcessAlive(current.pid)) {
      throw new Error("Chrona database is already in use by another running process.", { cause: error });
    }
    throw new Error(
      "Chrona found a stale database maintenance lock. Confirm no Chrona process is using the database, then run `chrona doctor --repair-stale-lock` to quarantine it.",
      { cause: error },
    );
  }

  let released = false;
  return {
    databasePath: path,
    lockPath,
    release() {
      if (released) return;
      released = true;
      const current = readOwner(lockPath);
      if (current?.pid === owner.pid && current.createdAt === owner.createdAt) {
        rmSync(lockPath, { force: true });
      }
    },
  };
}

export function withSqliteRuntimeLock<T>(
  databaseUrl: string,
  callback: () => T,
  options?: AcquireSqliteRuntimeLockOptions,
): T {
  const lock = acquireSqliteRuntimeLock(databaseUrl, options);
  try {
    return callback();
  } finally {
    lock.release();
  }
}

export function ensureSqliteRuntimeLockDirectory(databaseUrl: string): void {
  // Kept as a named public seam for callers that create data directories before ownership.
  // sqlite-url owns directory creation; this only validates the path shape.
  void dirname(databasePath(databaseUrl));
}

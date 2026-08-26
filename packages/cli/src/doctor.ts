import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { inspectSqliteRuntimeLock, quarantineStaleSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { assertPrivateStoragePath, sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { isExactLoopbackHost } from "@chrona/providers-foundation";
import { getChronaConfigDir, getChronaDataDir } from "./start-server.js";

export type ChronaDoctorCheck = {
  key: "database" | "databaseIntegrity" | "dataDirectoryPermissions" | "databasePermissions" | "databaseArtifactsPermissions" | "configDirectoryPermissions" | "configPermissions" | "runtimeLock" | "backupRestore" | "networkBind" | "apiProtection";
  status: "ok" | "warning" | "error";
  message: string;
};

type PermissionCheckKey = "dataDirectoryPermissions" | "databasePermissions" | "databaseArtifactsPermissions" | "configDirectoryPermissions" | "configPermissions";

function configuredDatabaseUrl(): string { return process.env.DATABASE_URL ?? `file:${join(getChronaDataDir(), "chrona.db")}`; }
function posixModeIsPrivate(path: string, expected: number): boolean { return (statSync(path).mode & 0o777) <= expected; }
function permissionsCheck(key: PermissionCheckKey, path: string, expected: number, label: string): ChronaDoctorCheck {
  if (process.platform === "win32") {
    if (!existsSync(path)) return { key, status: "warning", message: `${label} does not exist yet.` };
    try {
      assertPrivateStoragePath(path);
      return { key, status: "ok", message: `${label} has verified owner-only Windows ACLs for the current user and SYSTEM.` };
    } catch (error) {
      return { key, status: "error", message: `${label} Windows ACL audit failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (!existsSync(path)) return { key, status: "warning", message: `${label} does not exist yet.` };
  return posixModeIsPrivate(path, expected)
    ? { key, status: "ok", message: `${label} has owner-only POSIX permissions.` }
    : { key, status: "warning", message: `${label} permissions are broader than owner-only; run chmod ${expected.toString(8)} ${path}` };
}

function sensitiveDatabaseArtifacts(databasePath: string): string[] {
  const directory = dirname(databasePath);
  const databaseName = basename(databasePath);
  const adjacent = existsSync(directory)
    ? readdirSync(directory).filter((name) => name.startsWith(`${databaseName}-`) || name.startsWith(`${databaseName}.`))
      .map((name) => join(directory, name))
    : [];
  const backupRoot = join(directory, "backups");
  const automaticBackupDirectory = join(backupRoot, "pre-upgrade");
  const backups = existsSync(automaticBackupDirectory)
    ? readdirSync(automaticBackupDirectory).map((name) => join(automaticBackupDirectory, name))
    : [];
  return [...adjacent, backupRoot, automaticBackupDirectory, ...backups].filter((path) => existsSync(path));
}

function artifactPermissionsCheck(databasePath: string): ChronaDoctorCheck {
  const artifacts = sensitiveDatabaseArtifacts(databasePath);
  if (process.platform === "win32") {
    const insecure = artifacts.filter((path) => {
      try {
        assertPrivateStoragePath(path);
        return false;
      } catch {
        return true;
      }
    });
    return insecure.length === 0
      ? { key: "databaseArtifactsPermissions", status: "ok", message: artifacts.length === 0 ? "No SQLite sidecars, runtime locks, restore artifacts, or automatic backups are present." : "SQLite sidecars, runtime locks, restore artifacts, and automatic backups have verified owner-only Windows ACLs." }
      : { key: "databaseArtifactsPermissions", status: "error", message: `SQLite artifact Windows ACL audit failed: ${insecure.join(", ")}` };
  }
  const insecure = artifacts.filter((path) => !posixModeIsPrivate(path, statSync(path).isDirectory() ? 0o700 : 0o600));
  return insecure.length === 0
    ? { key: "databaseArtifactsPermissions", status: "ok", message: artifacts.length === 0 ? "No SQLite sidecars, runtime locks, restore artifacts, or automatic backups are present." : "SQLite sidecars, runtime locks, restore artifacts, and automatic backups have owner-only POSIX permissions." }
    : { key: "databaseArtifactsPermissions", status: "warning", message: `Sensitive SQLite artifacts have permissions broader than owner-only: ${insecure.join(", ")}` };
}

export function inspectLocalChrona(): ChronaDoctorCheck[] {
  const checks: ChronaDoctorCheck[] = [];
  const databaseUrl = configuredDatabaseUrl();
  const sqlitePath = sqlitePathFromFileUrl(databaseUrl);
  if (!sqlitePath || sqlitePath === ":memory:") {
    checks.push({ key: "database", status: "error", message: `Expected a persistent SQLite file URL, got ${databaseUrl}` });
  } else {
    const databasePath = resolve(sqlitePath);
    const present = existsSync(databasePath);
    checks.push({ key: "database", status: present ? "ok" : "warning", message: present ? `Database found at ${databasePath}` : `Database not created yet at ${databasePath}; chrona start will initialize it` });
    checks.push(permissionsCheck("dataDirectoryPermissions", dirname(databasePath), 0o700, "Database directory"));
    checks.push(permissionsCheck("databasePermissions", databasePath, 0o600, "Database"));
    checks.push(artifactPermissionsCheck(databasePath));
    if (present) {
      try {
        const db = new Database(databasePath, { readonly: true });
        const result = db.query("PRAGMA quick_check").get() as { quick_check?: string } | null;
        db.close();
        checks.push({ key: "databaseIntegrity", status: result?.quick_check === "ok" ? "ok" : "error", message: result?.quick_check === "ok" ? "SQLite integrity check passed" : "SQLite integrity check failed; stop Chrona and restore a known-good backup" });
      } catch { checks.push({ key: "databaseIntegrity", status: "error", message: "Could not inspect SQLite database; stop Chrona and restore a known-good backup." }); }
    }
    const lock = inspectSqliteRuntimeLock(databaseUrl);
    checks.push({ key: "runtimeLock", status: lock.state === "missing" ? "ok" : lock.state === "live" ? "warning" : "error", message: lock.state === "missing" ? "No runtime lock is present." : lock.state === "live" ? `Database lock is held by PID ${lock.pid}.` : lock.state === "stale" ? `Stale database lock for PID ${lock.pid}; run chrona doctor --repair-stale-lock to quarantine it.` : "Malformed database lock; inspect it manually and do not delete it automatically." });
    const backupDir = join(resolve(databasePath, ".."), "backups", "pre-upgrade");
    checks.push({ key: "backupRestore", status: existsSync(backupDir) || !present ? "ok" : "warning", message: existsSync(backupDir) ? "Automatic upgrade backup directory is available." : "No automatic upgrade backup exists yet; Chrona creates one before a pending migration." });
  }
  checks.push(permissionsCheck("configDirectoryPermissions", getChronaConfigDir(), 0o700, "Config directory"));
  checks.push(permissionsCheck("configPermissions", join(getChronaConfigDir(), ".env"), 0o600, "Config .env"));
  const host = process.env.HOST ?? "127.0.0.1";
  const localOnly = isExactLoopbackHost(host);
  checks.push({ key: "networkBind", status: localOnly ? "ok" : "warning", message: localOnly ? `Chrona is limited to the local machine on ${host}` : `Chrona is configured for network access on ${host}` });
  checks.push({ key: "apiProtection", status: !localOnly && !process.env.API_KEY ? "error" : process.env.API_KEY ? "ok" : "warning", message: process.env.API_KEY ? "API_KEY protection is configured" : !localOnly ? "Non-loopback bind has no API_KEY; Chrona will refuse to start unless unsafe override is set" : "API_KEY is not configured; acceptable only for trusted localhost use" });
  return checks;
}

export function repairStaleRuntimeLock(): string | null { return quarantineStaleSqliteRuntimeLock(configuredDatabaseUrl()); }

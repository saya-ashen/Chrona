import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { checksumSql } from "@chrona/db/sqlite-migrations";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { createBunSqliteAdapter } from "prisma-adapter-bun-sqlite";
import { externalPackageCatalog } from "@chrona/engine/catalog";
import { fileURLToPath } from "node:url";
import { inspectSqliteRuntimeLock, quarantineStaleSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { assertPrivateStoragePath, sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";
import { isIP } from "node:net";
import { findResourceDir, getChronaConfigDir, getChronaDataDir } from "./start-server.js";

// Exact local endpoint classification, preserved from the retired provider helper.
function isExactLoopbackHost(host: string): boolean {
  const normalized = host.trim().replace(/^\[/, "").replace(/\]$/, "").split("%")[0]?.toLowerCase() ?? "";
  if (normalized === "localhost" || normalized === "::1") return true;
  return isIP(normalized) === 4 && normalized.startsWith("127.");
}

export type ChronaDoctorCheck = {
  key: "git" | "executionMode" | "database" | "databaseIntegrity" | "migrationHistory" | "providerPi" | "externalApps" | "dataDirectoryPermissions" | "databasePermissions" | "databaseArtifactsPermissions" | "configDirectoryPermissions" | "configPermissions" | "runtimeLock" | "backupRestore" | "networkBind" | "apiProtection";
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

function executionModeCheck(): ChronaDoctorCheck {
  const mode = process.env.CHRONA_STEWARD_EXECUTION_MODE?.trim();
  if (process.env.CHRONA_STEWARD_SANDBOX_BWRAP?.trim()) {
    return { key: "executionMode", status: "error", message: "CHRONA_STEWARD_SANDBOX_BWRAP has been removed. Remove this setting and use trusted-local execution with host user permissions." };
  }
  if (mode && mode !== "trusted-local") {
    return { key: "executionMode", status: "error", message: "CHRONA_STEWARD_EXECUTION_MODE supports only trusted-local; required-isolation has been removed. Remove the setting or explicitly set trusted-local to run with host user permissions." };
  }
  return { key: "executionMode", status: "ok", message: "Execution mode is trusted-local. Modules and Provider run with host user permissions, without OS isolation or a hard virtual-memory limit." };
}

function providerPiCheck(): ChronaDoctorCheck[] {
  // Pi is the ordinary Provider configured by apps/server/src/steward-runtime.ts.
  if (process.env.CHRONA_STEWARD_AGENT && process.env.CHRONA_STEWARD_AGENT !== "pi") return [];
  const key = "providerPi";
  const checks: ChronaDoctorCheck[] = [];
  const command = process.env.CHRONA_STEWARD_PI_COMMAND ?? "";
  if (!isAbsolute(command)) checks.push({ key, status: "error", message: "Configure CHRONA_STEWARD_PI_COMMAND as an absolute Pi executable path." });
  const version = process.env.CHRONA_STEWARD_PI_VERSION ?? "0.85.0";
  // Synchronous equivalent of packages/pi/src/pi-completion.ts TOKEN_LIMIT_PI_VERSION.
  if (version !== "1.5.0") checks.push({ key, status: "warning", message: `Pi completion requires CHRONA_STEWARD_PI_VERSION=1.5.0 (configured ${version}); agent runs work, but bounded model calls by apps are unavailable.` });
  if (!checks.length) checks.push({ key, status: "ok", message: "Pi 1.5.0 is configured with an absolute command path and supports bounded model calls." });
  return checks;
}

function bundledMigrations() {
  const directory = process.env.CHRONA_MIGRATIONS_DIR ?? join(findResourceDir(), "prisma", "migrations");
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, checksum: checksumSql(readFileSync(join(directory, entry.name, "migration.sql"), "utf8")) }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!migrations.length) throw new Error(`No migrations found in: ${directory}`);
  return migrations;
}

function migrationHistoryCheck(databasePath: string): ChronaDoctorCheck {
  const key = "migrationHistory";
  if (!existsSync(databasePath)) return { key, status: "ok", message: "Database not created yet; migrations will be applied on startup." };
  try {
    const migrations = bundledMigrations();
    const db = new Database(databasePath, { readonly: true });
    try {
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
      const tracked = tables.some(table => table.name === "_chrona_migrations");
      if (tables.length && !tracked) return { key, status: "error", message: "Refusing an untracked database; steward requires a clean database baseline." };
      const applied = tracked ? db.query<{ name: string; checksum: string }, []>('SELECT name, checksum FROM "_chrona_migrations" ORDER BY name').all() : [];
      for (const [index, prior] of applied.entries()) {
        const migration = migrations.at(index);
        if (!migration || migration.name !== prior.name || migration.checksum !== prior.checksum) {
          return { key, status: "error", message: `Database was created by a different schema baseline (${prior.name}); this release will refuse to start. Back up with \`chrona backup\`, then start on a fresh data directory.` };
        }
      }
      return { key, status: "ok", message: `${migrations.length - applied.length} pending migrations.` };
    } finally { db.close(); }
  } catch (error) {
    const message = `Could not inspect migration history: ${error instanceof Error ? error.message : String(error)}`;
    return { key, status: "error", message };
  }
}

export function inspectLocalChrona(): ChronaDoctorCheck[] {
  const git = spawnSync("git", ["--version"], { encoding: "utf8", timeout: 5_000, maxBuffer: 4096, windowsHide: true });
  const gitAvailable = git.status === 0 && /^git version /m.test(git.stdout);
  const checks: ChronaDoctorCheck[] = [{ key: "git", status: gitAvailable ? "ok" : "error", message: gitAvailable ? "Git is available for module source repositories." : "Git is required for module source repositories. Install Git and make it available on the Chrona process PATH, then rerun chrona doctor." }, executionModeCheck(), ...providerPiCheck()];
  const databaseUrl = configuredDatabaseUrl();
  const sqlitePath = sqlitePathFromFileUrl(databaseUrl);
  if (!sqlitePath || sqlitePath === ":memory:") {
    checks.push({ key: "database", status: "error", message: `Expected a persistent SQLite file URL, got ${databaseUrl}` });
  } else {
    const databasePath = resolve(sqlitePath);
    const present = existsSync(databasePath);
    checks.push({ key: "database", status: present ? "ok" : "warning", message: present ? `Database found at ${databasePath}` : `Database not created yet at ${databasePath}; chrona start will initialize it` });
    checks.push(migrationHistoryCheck(databasePath));
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

function externalResources(): string {
  // Same resolution as integrations/steward/module-runtime.ts resourcePath, without its runtime imports.
  const adjacent = join(dirname(process.execPath), "resources");
  const root = process.env.CHRONA_RESOURCE_DIR || (existsSync(adjacent) ? adjacent : null);
  return root ? join(root, "external") : fileURLToPath(new URL("../../engine/src/modules/steward/external", import.meta.url));
}

async function externalAppWarnings(db: PrismaClient) {
  const catalog = await externalPackageCatalog({ db, dataDir: getChronaDataDir(), now: () => new Date(), publicUrl: null, moduleExternalResources: externalResources() }, "ws_default");
  const messages: string[] = [];
  for (const entry of catalog) {
    if (entry.error) messages.push(`${entry.name}: ${entry.error}`);
    if (entry.moduleId && entry.releaseHash) {
      const module = await db.module.findUniqueOrThrow({ where: { id: entry.moduleId } });
      if (entry.releaseHash !== module.activeHash) messages.push(`${entry.name}: bundled release differs from installed version; stop Chrona and run chrona admin install ${entry.name} --update --request-key <new-key>`);
    }
  }
  return messages;
}

export async function inspectExternalApps(): Promise<ChronaDoctorCheck> {
  const key = "externalApps";
  const path = sqlitePathFromFileUrl(configuredDatabaseUrl());
  if (!path || path === ":memory:") return { key, status: "warning", message: "Cannot inspect external apps without a persistent SQLite database." };
  if (!existsSync(path)) return { key, status: "ok", message: "Database not created yet; no installed external apps to compare." };
  const db = new PrismaClient({ adapter: {
    provider: "sqlite", adapterName: "prisma-adapter-bun-sqlite",
    connect: async () => createBunSqliteAdapter(new Database(path, { readonly: true, safeIntegers: true })),
  } });
  try {
    // Catalog needs only resource paths and database reads; no supervisor or runtime is created.
    const messages = await externalAppWarnings(db);
    return { key, status: messages.length ? "warning" : "ok", message: messages.join("; ") || "Installed external apps match the bundled releases." };
  } catch (error) {
    const message = `Could not inspect external apps: ${error instanceof Error ? error.message : String(error)}`;
    return { key, status: "warning", message };
  } finally { await db.$disconnect(); }
}

export function repairStaleRuntimeLock(): string | null { return quarantineStaleSqliteRuntimeLock(configuredDatabaseUrl()); }

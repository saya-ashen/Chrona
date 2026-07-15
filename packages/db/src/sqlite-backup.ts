import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

import { sqlitePathFromFileUrl } from "./sqlite-url";

export type SqliteBackupResult = {
  sourcePath: string;
  backupPath: string;
};

function requireFilePath(databaseUrl: string): string {
  const sqlitePath = sqlitePathFromFileUrl(databaseUrl);
  if (!sqlitePath || sqlitePath === ":memory:") {
    throw new Error(`Chrona backup requires a SQLite file URL, got: ${databaseUrl}`);
  }
  return resolve(sqlitePath);
}

function quoteSqliteLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function assertHealthyDatabase(databasePath: string): void {
  const db = new Database(databasePath, { readonly: true });
  try {
    const result = db.query("PRAGMA quick_check").get() as { quick_check?: string } | null;
    if (result?.quick_check !== "ok") {
      throw new Error(`SQLite integrity check failed for ${databasePath}`);
    }
  } finally {
    db.close();
  }
}

export function backupSqliteDatabase(databaseUrl: string, outputPath: string): SqliteBackupResult {
  const sourcePath = requireFilePath(databaseUrl);
  const backupPath = resolve(outputPath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Chrona database not found: ${sourcePath}`);
  }
  if (sourcePath === backupPath) {
    throw new Error("Backup destination must differ from the active Chrona database.");
  }

  mkdirSync(dirname(backupPath), { recursive: true });
  const db = new Database(sourcePath);
  try {
    db.run(`VACUUM INTO '${quoteSqliteLiteral(backupPath)}'`);
  } finally {
    db.close();
  }
  assertHealthyDatabase(backupPath);
  return { sourcePath, backupPath };
}

export function restoreSqliteDatabase(
  databaseUrl: string,
  inputPath: string,
  options: { force?: boolean } = {},
): SqliteBackupResult {
  const sourcePath = resolve(inputPath);
  const backupPath = requireFilePath(databaseUrl);
  if (!existsSync(sourcePath)) {
    throw new Error(`Backup database not found: ${sourcePath}`);
  }
  if (sourcePath === backupPath) {
    throw new Error("Restore source must differ from the active Chrona database.");
  }
  if (existsSync(backupPath) && !options.force) {
    throw new Error(`Chrona database already exists: ${backupPath}. Pass --force to replace it.`);
  }

  assertHealthyDatabase(sourcePath);
  mkdirSync(dirname(backupPath), { recursive: true });
  const temporaryPath = `${backupPath}.restore-${process.pid}-${Date.now()}`;
  copyFileSync(sourcePath, temporaryPath);
  assertHealthyDatabase(temporaryPath);
  rmSync(`${backupPath}-wal`, { force: true });
  rmSync(`${backupPath}-shm`, { force: true });
  if (existsSync(backupPath)) rmSync(backupPath, { force: true });
  copyFileSync(temporaryPath, backupPath);
  rmSync(temporaryPath, { force: true });
  return { sourcePath, backupPath };
}

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { backupSqliteDatabase, restoreSqliteDatabase } from "./sqlite-backup";

function createDatabase(path: string, value: string): void {
  const db = new Database(path);
  try {
    db.run('CREATE TABLE "Example" ("value" TEXT NOT NULL)');
    db.run('INSERT INTO "Example" ("value") VALUES (?)', [value]);
  } finally {
    db.close();
  }
}

function readValue(path: string): string {
  const db = new Database(path, { readonly: true });
  try {
    return (db.query('SELECT "value" FROM "Example"').get() as { value: string }).value;
  } finally {
    db.close();
  }
}

describe("SQLite backup and restore", () => {
  it("creates a consistent backup while WAL mode is active", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-backup-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backups", "chrona.db");
      createDatabase(databasePath, "preserved");

      const result = backupSqliteDatabase(`file:${databasePath}`, backupPath);

      expect(result.backupPath).toBe(backupPath);
      expect(readValue(backupPath)).toBe("preserved");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses overwrite by default and restores only with force", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-restore-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "current");
      createDatabase(backupPath, "restored");

      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath)).toThrow("Pass --force");
      restoreSqliteDatabase(`file:${databasePath}`, backupPath, { force: true });

      expect(readValue(databasePath)).toBe("restored");
      expect(existsSync(`${databasePath}-wal`)).toBe(false);
      expect(existsSync(`${databasePath}-shm`)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a corrupt backup before replacing user data", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-corrupt-restore-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const backupPath = join(directory, "backup.db");
      createDatabase(databasePath, "current");
      Bun.write(backupPath, "not sqlite");

      expect(() => restoreSqliteDatabase(`file:${databasePath}`, backupPath, { force: true })).toThrow();
      expect(readValue(databasePath)).toBe("current");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

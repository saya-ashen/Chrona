import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import {
  checksumSql,
  ensureSqliteDatabase,
  schemaFingerprint,
  verifyMigrationReleaseMetadata,
} from "./sqlite-migrations";

function createMigration(root: string, name: string, sql: string): void {
  const migrationDir = join(root, name);
  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(join(migrationDir, "migration.sql"), sql);
}

function releaseMigrationsDir(): string {
  return resolve(import.meta.dir, "../../../prisma/migrations");
}

function releaseFixturePath(migrationsDir: string, fixturePath: string): string {
  return join(migrationsDir, fixturePath);
}

describe("ensureSqliteDatabase", () => {
  it("applies migrations and records real checksums", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migrations-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    const sql = 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);';
    createMigration(migrationsDir, "20260101000000_init", sql);

    ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      const migration = db.query("SELECT checksum FROM _prisma_migrations WHERE migration_name = ?")
        .get("20260101000000_init") as { checksum: string } | null;
      expect(migration?.checksum).toBe(checksumSql(sql));
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Example'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("fails when an applied migration changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-drift-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    const migrationSqlPath = join(migrationsDir, "20260101000000_init", "migration.sql");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');

    ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir });
    writeFileSync(migrationSqlPath, `${readFileSync(migrationSqlPath, "utf8")}\n-- changed`);

    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).toThrow(
      "Migration checksum mismatch",
    );
  });

  it("refuses to infer a baseline from an unrelated schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-unrelated-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Expected" ("id" TEXT NOT NULL PRIMARY KEY);');

    const db = new Database(dbPath);
    db.run('CREATE TABLE "Unrelated" ("id" TEXT NOT NULL PRIMARY KEY)');
    db.close();

    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).toThrow(
      "Database contains application tables but no migration history",
    );

    const after = new Database(dbPath, { readonly: true });
    try {
      expect(after.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Expected'").get()).toBeNull();
      expect(after.query("SELECT COUNT(*) AS count FROM _prisma_migrations").get()).toEqual({ count: 0 });
    } finally {
      after.close();
    }
  });

  it("rolls back failed migration SQL without recording it as applied", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-rollback-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');
    createMigration(
      migrationsDir,
      "20260102000000_partial_failure",
      'CREATE TABLE "MustRollback" ("id" TEXT NOT NULL PRIMARY KEY);\nINSERT INTO "MissingTable" ("id") VALUES (\'nope\');',
    );

    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).toThrow("MissingTable");

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Example'").get()).toBeTruthy();
      expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'MustRollback'").get()).toBeNull();
      expect(
        db.query("SELECT migration_name FROM _prisma_migrations WHERE migration_name = ?")
          .get("20260102000000_partial_failure"),
      ).toBeNull();
    } finally {
      db.close();
    }
  });

  it("validates immutable prior release, fresh fingerprint, and preserved upgrade data", () => {
    const migrationsDir = releaseMigrationsDir();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir);
    expect(metadata).toBeTruthy();
    if (!metadata) throw new Error("Expected migration release metadata");

    const dir = mkdtempSync(join(tmpdir(), "chrona-release-migrations-"));
    const freshPath = join(dir, "fresh.db");
    ensureSqliteDatabase({ databaseUrl: `file:${freshPath}`, migrationsDir });

    const fresh = new Database(freshPath, { readonly: true });
    try {
      expect(schemaFingerprint(fresh)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(fresh.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(fresh.query("SELECT COUNT(*) AS count FROM _prisma_migrations").get()).toEqual({
        count: Object.keys(metadata.releasedMigrationChecksums).length + 1,
      });
    } finally {
      fresh.close();
    }

    const upgradePath = join(dir, "upgrade.db");
    cpSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.path), upgradePath);
    const prior = new Database(upgradePath, { readonly: true });
    let priorTask: { id: string; title: string } | null;
    try {
      expect(schemaFingerprint(prior)).toBe(metadata.lastReleasedSchemaFingerprint);
      priorTask = prior.query('SELECT "id", "title" FROM "Task" WHERE "id" = ?').get("fixture-task") as { id: string; title: string } | null;
    } finally {
      prior.close();
    }

    ensureSqliteDatabase({ databaseUrl: `file:${upgradePath}`, migrationsDir });
    const upgraded = new Database(upgradePath, { readonly: true });
    try {
      expect(schemaFingerprint(upgraded)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(upgraded.query('SELECT "id", "title" FROM "Task" WHERE "id" = ?').get("fixture-task")).toEqual(priorTask);
      expect(upgraded.query("SELECT COUNT(*) AS count FROM _prisma_migrations").get()).toEqual({
        count: Object.keys(metadata.releasedMigrationChecksums).length + 1,
      });
    } finally {
      upgraded.close();
    }
  });
});

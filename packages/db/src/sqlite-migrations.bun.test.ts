import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { ensureSqliteDatabase } from "./sqlite-migrations";

function createMigration(root: string, name: string, sql: string): void {
  const migrationDir = join(root, name);
  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(join(migrationDir, "migration.sql"), sql);
}

describe("ensureSqliteDatabase", () => {
  it("applies migrations and records real checksums", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migrations-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');

    ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      const migration = db.query("SELECT checksum FROM _prisma_migrations WHERE migration_name = ?")
        .get("20260101000000_init") as { checksum: string } | null;
      expect(migration?.checksum).toHaveLength(64);
      expect(migration?.checksum).not.toBe("");
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

  it("baselines a pre-existing schema instead of re-applying (prisma db push)", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-baseline-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');

    // Simulate `prisma db push`: the schema exists but no _prisma_migrations rows.
    const seed = new Database(dbPath);
    seed.run('CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY)');
    seed.close();

    // Must not throw "table Example already exists".
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).not.toThrow();

    const db = new Database(dbPath, { readonly: true });
    try {
      const migration = db.query("SELECT applied_steps_count FROM _prisma_migrations WHERE migration_name = ?")
        .get("20260101000000_init") as { applied_steps_count: number } | null;
      expect(migration).toBeTruthy();
      // Baselined: recorded as applied but with 0 executed steps.
      expect(migration?.applied_steps_count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("baselines a new migration whose column already exists (prisma db push after migrate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-partial-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');

    // First migration is applied normally via the runner.
    ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir });

    // A new migration is added, but its column was already pushed out-of-band
    // (e.g. `prisma db push`), so re-running its SQL would crash with
    // "duplicate column name".
    const seed = new Database(dbPath);
    seed.run('ALTER TABLE "Example" ADD COLUMN "note" TEXT');
    seed.close();
    createMigration(migrationsDir, "20260102000000_add_note", 'ALTER TABLE "Example" ADD COLUMN "note" TEXT;');

    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).not.toThrow();

    const db = new Database(dbPath, { readonly: true });
    try {
      const migration = db.query("SELECT applied_steps_count FROM _prisma_migrations WHERE migration_name = ?")
        .get("20260102000000_add_note") as { applied_steps_count: number } | null;
      expect(migration).toBeTruthy();
      // Baselined on conflict: recorded as applied with 0 executed steps.
      expect(migration?.applied_steps_count).toBe(0);
    } finally {
      db.close();
    }
  });
});

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { ensureSqliteParentDir, sqlitePathFromFileUrl } from "./sqlite-url";

type AppliedMigration = {
  checksum: string;
  migration_name: string;
};

type EnsureSqliteDatabaseOptions = {
  databaseUrl: string;
  migrationsDir: string;
  reset?: boolean;
  log?: (message: string) => void;
};

function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function hasExecutableStatement(sql: string): boolean {
  return sql
    .split(/\r?\n/)
    .some((line) => line.trim() && !line.trim().startsWith("--"));
}

function createMigrationsTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
}

function readAppliedMigrations(db: Database): Map<string, AppliedMigration> {
  const rows = db.query("SELECT migration_name, checksum FROM _prisma_migrations")
    .all() as AppliedMigration[];

  return new Map(rows.map((row) => [row.migration_name, row]));
}

/**
 * True when the database already holds application tables created outside the
 * migration runner (e.g. via `prisma db push`). We ignore SQLite-internal
 * tables and our own bookkeeping table so a genuinely fresh database reads as
 * empty.
 */
function hasExistingSchema(db: Database): boolean {
  const row = db
    .query(
      `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name <> '_prisma_migrations'`,
    )
    .get() as { count: number } | undefined;

  return (row?.count ?? 0) > 0;
}

/**
 * Record a migration as applied without running its SQL. Used to baseline a
 * schema that already exists (e.g. from `prisma db push`) so the runner does
 * not try to re-`CREATE TABLE` over live tables and crash.
 */
function baselineMigration(db: Database, migrationName: string, checksum: string): void {
  db.run(
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), checksum, migrationName, new Date().toISOString(), 0],
  );
}

/**
 * True when a migration error means its schema objects already exist (e.g. the
 * database was synced out-of-band with `prisma db push`, then a new migration
 * was added). The runner treats this as a baseline instead of crashing.
 */
function isSchemaAlreadyPresentError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /duplicate column name|already exists/i.test(error.message);
}

function applyMigration(db: Database, migrationName: string, sql: string, checksum: string): void {
  const apply = db.transaction(() => {
    if (hasExecutableStatement(sql)) {
      db.run(sql);
    }

    db.run(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), checksum, migrationName, new Date().toISOString(), 1],
    );
  });

  try {
    apply();
  } catch (error) {
    if (isSchemaAlreadyPresentError(error)) {
      // Schema was pushed out-of-band; the transaction rolled back, so record
      // this migration as applied without re-running its SQL.
      baselineMigration(db, migrationName, checksum);
      return;
    }
    throw error;
  }
}

export function ensureSqliteDatabase(options: EnsureSqliteDatabaseOptions): void {
  const sqlitePath = sqlitePathFromFileUrl(options.databaseUrl);
  if (!sqlitePath) {
    throw new Error(`Chrona requires a SQLite file URL, got: ${options.databaseUrl}`);
  }

  if (sqlitePath !== ":memory:" && options.reset && existsSync(sqlitePath)) {
    rmSync(sqlitePath, { force: true });
  }

  ensureSqliteParentDir(options.databaseUrl);

  const db = new Database(sqlitePath);
  try {
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    if (sqlitePath !== ":memory:") {
      db.run("PRAGMA journal_mode = WAL");
    }

    createMigrationsTable(db);

    if (!existsSync(options.migrationsDir)) {
      throw new Error(`Migration directory not found: ${options.migrationsDir}`);
    }

    const appliedMigrations = readAppliedMigrations(db);
    const entries = readdirSync(options.migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    if (entries.length === 0) {
      throw new Error(`No migrations found in: ${options.migrationsDir}`);
    }

    // A schema pushed with `prisma db push` has the tables but no
    // `_prisma_migrations` rows. Re-running the migration SQL would
    // `CREATE TABLE` over live tables and crash ("table AiClient already
    // exists"). Baseline instead: mark every migration applied without
    // running its SQL, matching `prisma migrate resolve --applied`.
    const shouldBaseline = appliedMigrations.size === 0 && hasExistingSchema(db);

    for (const entry of entries) {
      const sqlPath = join(options.migrationsDir, entry.name, "migration.sql");
      if (!existsSync(sqlPath)) {
        continue;
      }

      const sql = readFileSync(sqlPath, "utf8");
      const checksum = checksumSql(sql);
      const applied = appliedMigrations.get(entry.name);
      if (applied) {
        if (applied.checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for ${entry.name}. The database was created with different migration SQL.`,
          );
        }
        continue;
      }

      if (shouldBaseline) {
        options.log?.(`  Baselining existing schema: ${entry.name}`);
        baselineMigration(db, entry.name, checksum);
        continue;
      }

      options.log?.(`  Running migration: ${entry.name}`);
      applyMigration(db, entry.name, sql, checksum);
    }
  } finally {
    db.close();
  }
}

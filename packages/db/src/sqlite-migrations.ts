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

  apply();
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

      options.log?.(`  Running migration: ${entry.name}`);
      applyMigration(db, entry.name, sql, checksum);
    }
  } finally {
    db.close();
  }
}

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { assertPrivateStoragePath, ensureSqliteParentDir, secureGeneratedPrivateFile, sqlitePathFromFileUrl } from "./sqlite-url";

export type EnsureSqliteDatabaseOptions = {
  databaseUrl: string;
  migrationsDir: string;
  log?: (message: string) => void;
};

export function checksumSql(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Clean-baseline migrations only. Never adopt or normalize an existing untracked database. */
export function ensureSqliteDatabase({ databaseUrl, migrationsDir, log }: EnsureSqliteDatabaseOptions): void {
  const path = sqlitePathFromFileUrl(databaseUrl);
  if (!path || path === ":memory:") {
    throw new Error("Migration startup requires a persistent SQLite file URL.");
  }
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sql = readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf8");
      return { name: entry.name, sql, checksum: checksumSql(sql) };
    })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (!migrations.length) throw new Error(`No migrations found in: ${migrationsDir}`);

  ensureSqliteParentDir(databaseUrl);
  const existed = existsSync(path);
  if (existed) assertPrivateStoragePath(path);
  const db = new Database(path, { create: true });
  const appliedNames: string[] = [];
  try {
    if (!existed) secureGeneratedPrivateFile(path);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    // One write lock covers validation, DDL and history: concurrent starts cannot race.
    db.transaction(() => {
      const tables = db.query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      ).all();
      if (tables.length && !tables.some((table) => table.name === "_chrona_migrations")) {
        throw new Error("Refusing an untracked database; steward requires a clean database baseline.");
      }
      db.exec(`CREATE TABLE IF NOT EXISTS "_chrona_migrations" (
        "name" TEXT NOT NULL PRIMARY KEY,
        "checksum" TEXT NOT NULL,
        "appliedAt" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      const applied = db.query<{ name: string; checksum: string }, []>(
        'SELECT name, checksum FROM "_chrona_migrations" ORDER BY name',
      ).all();
      // History must be an exact prefix, including checksums. Missing/reordered files fail closed.
      for (const [index, prior] of applied.entries()) {
        const migration = migrations.at(index);
        if (!migration || migration.name !== prior.name) {
          throw new Error(`Applied migration history mismatch: ${prior.name}`);
        }
        if (migration.checksum !== prior.checksum) {
          throw new Error(`Applied migration checksum changed: ${prior.name}`);
        }
      }
      for (const migration of migrations.slice(applied.length)) {
        db.exec(migration.sql);
        db.query('INSERT INTO "_chrona_migrations" (name, checksum) VALUES (?, ?)')
          .run(migration.name, migration.checksum);
        appliedNames.push(migration.name);
      }
      if (db.query("PRAGMA foreign_key_check").all().length) {
        throw new Error("Migration foreign key check failed");
      }
    }).immediate();
  } finally {
    db.close();
  }
  for (const name of appliedNames) log?.(`Applied migration ${name}`);
}

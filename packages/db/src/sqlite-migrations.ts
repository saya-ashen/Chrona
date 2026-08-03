import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { ensureSqliteParentDir, sqlitePathFromFileUrl } from "./sqlite-url";

type AppliedMigration = {
  checksum: string;
  migration_name: string;
};

type Migration = {
  checksum: string;
  name: string;
  sql: string;
};

export type MigrationReleaseMetadata = {
  formatVersion: 1;
  lastReleasedMigration: string;
  lastReleasedSchemaFingerprint: string;
  lastReleasedVersion: string;
  mutableReleaseLineMigration: string;
  previousReleaseFixture: { path: string; sha256: string };
  /** Fingerprint of a fresh install through the sole mutable migration. */
  releaseLineSchemaFingerprint: string;
  releasedMigrationChecksums: Record<string, string>;
};

type EnsureSqliteDatabaseOptions = {
  /** Explicitly resolves an out-of-band schema only if it matches a recorded release. */
  baselineRelease?: string;
  databaseUrl: string;
  log?: (message: string) => void;
  migrationsDir: string;
  reset?: boolean;
};

const MIGRATION_METADATA_FILE = "release-metadata.json";
const SHA256 = /^[a-f0-9]{64}$/;
export function checksumSql(sql: string | Uint8Array): string {
  return createHash("sha256").update(sql).digest("hex");
}

/** Deterministic fingerprint of every application-owned SQLite schema object. */
export function schemaFingerprint(db: Database): string {
  const rows = db.query(
    `SELECT type, name, tbl_name, COALESCE(sql, '') AS sql
       FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'
      ORDER BY type, name, tbl_name, sql`,
  ).all() as Array<{ name: string; sql: string; tbl_name: string; type: string }>;
  return checksumSql(rows.map((row) => `${row.type}\u0000${row.name}\u0000${row.tbl_name}\u0000${row.sql}`).join("\n"));
}

function hasExecutableStatement(sql: string): boolean {
  return sql.split(/\r?\n/).some((line) => line.trim() && !line.trim().startsWith("--"));
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
  const rows = db.query("SELECT migration_name, checksum FROM _prisma_migrations").all() as AppliedMigration[];
  return new Map(rows.map((row) => [row.migration_name, row]));
}

function hasExistingSchema(db: Database): boolean {
  const row = db.query(
    `SELECT COUNT(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`,
  ).get() as { count: number } | undefined;
  return (row?.count ?? 0) > 0;
}

function loadMigrations(migrationsDir: string): Migration[] {
  if (!existsSync(migrationsDir)) throw new Error(`Migration directory not found: ${migrationsDir}`);
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, sqlPath: join(migrationsDir, entry.name, "migration.sql") }))
    .filter(({ sqlPath }) => existsSync(sqlPath))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, sqlPath }) => {
      const sql = readFileSync(sqlPath, "utf8");
      return { checksum: checksumSql(sql), name, sql };
    });
  if (migrations.length === 0) throw new Error(`No migrations found in: ${migrationsDir}`);
  return migrations;
}

function readReleaseMetadata(migrationsDir: string): unknown {
  const path = join(migrationsDir, MIGRATION_METADATA_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid migration release metadata at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPreviousReleaseFixture(value: unknown): value is MigrationReleaseMetadata["previousReleaseFixture"] {
  return isRecord(value)
    && typeof value.path === "string"
    && typeof value.sha256 === "string"
    && SHA256.test(value.sha256);
}

function isReleasedMigrationChecksums(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((checksum) => typeof checksum === "string");
}

function isMigrationReleaseMetadata(value: unknown): value is MigrationReleaseMetadata {
  if (!isRecord(value)) return false;
  return value.formatVersion === 1
    && typeof value.lastReleasedVersion === "string"
    && typeof value.lastReleasedMigration === "string"
    && typeof value.mutableReleaseLineMigration === "string"
    && typeof value.lastReleasedSchemaFingerprint === "string"
    && SHA256.test(value.lastReleasedSchemaFingerprint)
    && typeof value.releaseLineSchemaFingerprint === "string"
    && SHA256.test(value.releaseLineSchemaFingerprint)
    && isPreviousReleaseFixture(value.previousReleaseFixture)
    && isReleasedMigrationChecksums(value.releasedMigrationChecksums);
}

function releasedMigrations(metadata: MigrationReleaseMetadata, migrations: Migration[]): Migration[] {
  const releasedIndex = migrations.findIndex(({ name }) => name === metadata.lastReleasedMigration);
  if (releasedIndex < 0) {
    throw new Error(`Migration metadata names missing released migration ${metadata.lastReleasedMigration}`);
  }
  const released = migrations.slice(0, releasedIndex + 1);
  const releasedNames = new Set(released.map(({ name }) => name));
  const declaredNames = Object.keys(metadata.releasedMigrationChecksums);
  if (declaredNames.length !== released.length || declaredNames.some((name) => !releasedNames.has(name))) {
    throw new Error("Migration metadata must declare every released checksum and no mutable migration");
  }
  for (const migration of released) {
    const recordedChecksum = metadata.releasedMigrationChecksums[migration.name];
    if (!SHA256.test(recordedChecksum) || recordedChecksum !== migration.checksum) {
      throw new Error(`Released migration checksum mismatch for ${migration.name}`);
    }
  }
  return released;
}

function verifyPreviousReleaseFixture(metadata: MigrationReleaseMetadata, released: Migration[], migrationsDir: string): void {
  const fixturePath = join(migrationsDir, metadata.previousReleaseFixture.path);
  if (!existsSync(fixturePath) || checksumSql(readFileSync(fixturePath)) !== metadata.previousReleaseFixture.sha256) {
    throw new Error(`Previous-release fixture checksum mismatch: ${fixturePath}`);
  }
  const fixture = new Database(fixturePath, { readonly: true });
  try {
    if (schemaFingerprint(fixture) !== metadata.lastReleasedSchemaFingerprint) {
      throw new Error(`Previous-release fixture schema fingerprint mismatch: ${fixturePath}`);
    }
    const applied = readAppliedMigrations(fixture);
    if (applied.size !== released.length || released.some((migration) => applied.get(migration.name)?.checksum !== migration.checksum)) {
      throw new Error(`Previous-release fixture migration history mismatch: ${fixturePath}`);
    }
  } finally {
    fixture.close();
  }
}

function verifyReleaseLineSchema(metadata: MigrationReleaseMetadata, migrations: Migration[]): void {
  const fresh = new Database(":memory:");
  try {
    createMigrationsTable(fresh);
    for (const migration of migrations) {
      if (hasExecutableStatement(migration.sql)) fresh.run(migration.sql);
    }
    if (schemaFingerprint(fresh) !== metadata.releaseLineSchemaFingerprint) {
      throw new Error("Fresh release-line schema fingerprint mismatch");
    }
  } finally {
    fresh.close();
  }
}

/** Validates the machine-readable immutable/mutable migration release boundary. */
export function verifyMigrationReleaseMetadata(migrationsDir: string): MigrationReleaseMetadata | undefined {
  const value = readReleaseMetadata(migrationsDir);
  if (value === undefined) return undefined;
  if (!isMigrationReleaseMetadata(value)) {
    throw new Error(`Invalid migration release metadata at ${join(migrationsDir, MIGRATION_METADATA_FILE)}`);
  }
  const migrations = loadMigrations(migrationsDir);
  const released = releasedMigrations(value, migrations);
  const mutable = migrations.slice(released.length);
  if (mutable.length !== 1 || mutable[0]?.name !== value.mutableReleaseLineMigration) {
    throw new Error(`Migration metadata requires exactly one mutable release-line migration (${value.mutableReleaseLineMigration}) after ${value.lastReleasedMigration}`);
  }
  verifyPreviousReleaseFixture(value, released, migrationsDir);
  verifyReleaseLineSchema(value, migrations);
  return value;
}

function baselineMigration(db: Database, migration: Migration): void {
  db.run(
    `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), migration.checksum, migration.name, new Date().toISOString(), 0],
  );
}

function baselineReleasedSchema(
  db: Database,
  migrations: Migration[],
  metadata: MigrationReleaseMetadata | undefined,
  release: string | undefined,
): void {
  if (!release) {
    throw new Error("Database contains application tables but no migration history. Refusing to infer a baseline; explicitly resolve a recorded release after verifying its provenance.");
  }
  if (!metadata || release !== metadata.lastReleasedVersion) throw new Error(`Cannot baseline unknown migration release ${release}`);
  if (schemaFingerprint(db) !== metadata.lastReleasedSchemaFingerprint) {
    throw new Error(`Cannot baseline ${release}: database schema fingerprint does not match the recorded release`);
  }
  const end = migrations.findIndex(({ name }) => name === metadata.lastReleasedMigration);
  if (end < 0) throw new Error(`Cannot baseline ${release}: released migration is unavailable`);
  for (const migration of migrations.slice(0, end + 1)) baselineMigration(db, migration);
}

const PIN_TASK_EXECUTION_MIGRATION = "20260728000000_pin_task_execution_model";

function assertPinTaskExecutionUpgradeReady(db: Database, migration: Migration): void {
  if (migration.name !== PIN_TASK_EXECUTION_MIGRATION) return;
  const table = db.query(
    `SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'TaskPlanRun'`,
  ).get() as { present: number } | null;
  if (!table) return;
  const columns = db.query(`PRAGMA table_info("TaskPlanRun")`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "workBlockScopeKey")) return;
  if (!columns.some((column) => column.name === "workBlockId")) return;
  const duplicate = db.query(
    `SELECT "taskId", "planId", COALESCE("workBlockId", '') AS "scopeKey", COUNT(*) AS "count"
       FROM "TaskPlanRun"
      GROUP BY "taskId", "planId", COALESCE("workBlockId", '')
     HAVING COUNT(*) > 1
      LIMIT 1`,
  ).get() as { taskId: string; planId: string; scopeKey: string; count: number } | null;
  if (!duplicate) return;
  throw new Error(
    `Cannot apply ${PIN_TASK_EXECUTION_MIGRATION}: duplicate legacy TaskPlanRun scope ${duplicate.taskId}/${duplicate.planId}/${duplicate.scopeKey || "<task>"} requires operator cleanup before migration.`,
  );
}

type ForeignKeyViolation = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};

function assertNoForeignKeyViolations(db: Database, migration: Migration): void {
  const violation = db.query("PRAGMA foreign_key_check").get() as ForeignKeyViolation | null;
  if (!violation) return;
  throw new Error(
    `Cannot apply ${migration.name}: foreign key violation in ${violation.table} row ${violation.rowid ?? "<without rowid>"} referencing ${violation.parent} (constraint ${violation.fkid}).`,
  );
}

function applyMigration(db: Database, migration: Migration): void {
  const apply = db.transaction(() => {
    assertPinTaskExecutionUpgradeReady(db, migration);
    if (hasExecutableStatement(migration.sql)) db.run(migration.sql);
    assertNoForeignKeyViolations(db, migration);
    db.run(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), migration.checksum, migration.name, new Date().toISOString(), 1],
    );
  });
  // DDL and its history row are atomic. Never swallow duplicate-object errors.
  apply();
}

export function ensureSqliteDatabase(options: EnsureSqliteDatabaseOptions): void {
  const sqlitePath = sqlitePathFromFileUrl(options.databaseUrl);
  if (!sqlitePath) throw new Error(`Chrona requires a SQLite file URL, got: ${options.databaseUrl}`);
  const migrations = loadMigrations(options.migrationsDir);
  const metadata = verifyMigrationReleaseMetadata(options.migrationsDir);
  if (sqlitePath !== ":memory:" && options.reset && existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
  ensureSqliteParentDir(options.databaseUrl);
  const db = new Database(sqlitePath);
  try {
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    if (sqlitePath !== ":memory:") db.run("PRAGMA journal_mode = WAL");
    createMigrationsTable(db);
    if (readAppliedMigrations(db).size === 0 && hasExistingSchema(db)) {
      baselineReleasedSchema(db, migrations, metadata, options.baselineRelease);
    }
    const appliedMigrations = readAppliedMigrations(db);
    for (const migration of migrations) {
      const applied = appliedMigrations.get(migration.name);
      if (applied) {
        if (applied.checksum !== migration.checksum) {
          throw new Error(`Migration checksum mismatch for ${migration.name}. The database was created with different migration SQL.`);
        }
        continue;
      }
      options.log?.(`  Running migration: ${migration.name}`);
      applyMigration(db, migration);
    }
  } finally {
    db.close();
  }
}

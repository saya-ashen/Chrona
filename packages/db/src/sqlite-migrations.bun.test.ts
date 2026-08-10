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

function expectRawEventForeignKeyIndexes(db: Database): void {
  expect(db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get("Event_rawEventId_idx"))
    .toBeTruthy();
  expect(db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get("TaskTimelineItem_rawEventId_idx"))
    .toBeTruthy();
  const eventPlan = db.query('EXPLAIN QUERY PLAN SELECT 1 FROM "Event" WHERE "rawEventId" = ?').all("raw-event");
  const timelinePlan = db.query('EXPLAIN QUERY PLAN SELECT 1 FROM "TaskTimelineItem" WHERE "rawEventId" = ?').all("raw-event");
  expect(JSON.stringify(eventPlan)).toContain("Event_rawEventId_idx");
  expect(JSON.stringify(timelinePlan)).toContain("TaskTimelineItem_rawEventId_idx");
}


function expectEventScopeForeignKeys(db: Database): void {
  const rawEventForeignKeys = db.query('PRAGMA foreign_key_list("RawEventLog")').all() as Array<Record<string, unknown>>;
  const eventForeignKeys = db.query('PRAGMA foreign_key_list("Event")').all() as Array<Record<string, unknown>>;
  expect(rawEventForeignKeys).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: "workBlockId", table: "WorkBlock", on_delete: "SET NULL", on_update: "CASCADE" }),
    expect.objectContaining({ from: "occurrenceId", table: "TaskOccurrence", on_delete: "SET NULL", on_update: "CASCADE" }),
  ]));
  expect(eventForeignKeys).toEqual(expect.arrayContaining([
    expect.objectContaining({ from: "occurrenceId", table: "TaskOccurrence", on_delete: "SET NULL", on_update: "CASCADE" }),
  ]));
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

  it("rolls back a migration when foreign_key_check reports rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-foreign-key-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(
      migrationsDir,
      "20260101000000_init",
      'CREATE TABLE "Parent" ("id" TEXT NOT NULL PRIMARY KEY); CREATE TABLE "Child" ("id" TEXT NOT NULL PRIMARY KEY, "parentId" TEXT NOT NULL, FOREIGN KEY ("parentId") REFERENCES "Parent"("id"));',
    );
    ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir });
    const corrupt = new Database(dbPath);
    corrupt.run("PRAGMA foreign_keys = OFF");
    corrupt.run('INSERT INTO "Child" ("id", "parentId") VALUES (\'child-1\', \'missing-parent\')');
    corrupt.close();
    createMigration(
      migrationsDir,
      "20260102000000_detect_orphan",
      'CREATE TABLE "MustRollback" ("id" TEXT NOT NULL PRIMARY KEY);',
    );

    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).toThrow(
      "foreign key violation in Child row",
    );
    const database = new Database(dbPath, { readonly: true });
    try {
      expect(database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'MustRollback'").get()).toBeNull();
      expect(database.query("SELECT 1 FROM _prisma_migrations WHERE migration_name = ?").get("20260102000000_detect_orphan")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("fails closed before the released scope pin migration sees legacy duplicate plan runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-migration-duplicate-plan-run-"));
    const migrationsDir = join(dir, "migrations");
    const dbPath = join(dir, "chrona.db");
    createMigration(
      migrationsDir,
      "20260727000000_legacy_plan_runs",
      `CREATE TABLE "TaskPlanRun" ("id" TEXT NOT NULL PRIMARY KEY, "taskId" TEXT NOT NULL, "planId" TEXT NOT NULL, "workBlockId" TEXT);
       INSERT INTO "TaskPlanRun" ("id", "taskId", "planId", "workBlockId") VALUES ('run-a', 'task-1', 'plan-1', NULL);
       INSERT INTO "TaskPlanRun" ("id", "taskId", "planId", "workBlockId") VALUES ('run-b', 'task-1', 'plan-1', NULL);`,
    );
    createMigration(
      migrationsDir,
      "20260728000000_pin_task_execution_model",
      `ALTER TABLE "TaskPlanRun" ADD COLUMN "workBlockScopeKey" TEXT NOT NULL DEFAULT '';
       CREATE UNIQUE INDEX "TaskPlanRun_scope_key" ON "TaskPlanRun" ("taskId", "planId", "workBlockScopeKey");`,
    );

    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${dbPath}`, migrationsDir })).toThrow(
      "duplicate legacy TaskPlanRun scope task-1/plan-1/<task> requires operator cleanup before migration",
    );

    const database = new Database(dbPath, { readonly: true });
    try {
      expect(database.query(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ?`).get(
        "20260728000000_pin_task_execution_model",
      )).toBeNull();
      expect(database.query(`SELECT name FROM pragma_table_info('TaskPlanRun') WHERE name = 'workBlockScopeKey'`).get()).toBeNull();
    } finally {
      database.close();
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
      expectRawEventForeignKeyIndexes(fresh);
      expectEventScopeForeignKeys(fresh);
      expect(fresh.query("SELECT COUNT(*) AS count FROM _prisma_migrations").get()).toEqual({
        count: Object.keys(metadata.releasedMigrationChecksums).length + 1,
      });
    } finally {
      fresh.close();
    }

    const upgradePath = join(dir, "upgrade.db");
    cpSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.path), upgradePath);
    const prior = new Database(upgradePath);
    let priorTask: { id: string; title: string } | null;
    try {
      expect(schemaFingerprint(prior)).toBe(metadata.lastReleasedSchemaFingerprint);
      prior.exec(`
        UPDATE "Task"
        SET
          "kind" = 'recurring',
          "recurrenceRule" = 'FREQ=DAILY;COUNT=1',
          "recurrenceAnchorStartAt" = '2031-01-02T09:00:00.000Z',
          "recurrenceAnchorEndAt" = '2031-01-02T10:00:00.000Z',
          "recurrenceWindowUntil" = '2031-07-01T09:00:00.000Z'
        WHERE "id" = 'fixture-task';
        INSERT INTO "WorkBlock" (
          "id", "workspaceId", "taskId", "recurrenceKey", "title", "status",
          "scheduledStartAt", "scheduledEndAt", "trigger", "updatedAt"
        ) VALUES (
          'fixture-legacy-recurrence-block', 'fixture-workspace', 'fixture-task',
          '2031-01-02T09:00:00.000Z', 'Preserve fixture task', 'Scheduled',
          '2031-01-02T09:00:00.000Z', '2031-01-02T10:00:00.000Z', 'manual',
          '2026-07-23T00:00:00.000Z'
        );
      `);
      priorTask = prior.query('SELECT "id", "title" FROM "Task" WHERE "id" = ?').get("fixture-task") as { id: string; title: string } | null;
    } finally {
      prior.close();
    }

    ensureSqliteDatabase({ databaseUrl: `file:${upgradePath}`, migrationsDir });
    const upgraded = new Database(upgradePath, { readonly: true });
    try {
      expect(schemaFingerprint(upgraded)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expectRawEventForeignKeyIndexes(upgraded);
      expectEventScopeForeignKeys(upgraded);
      expect(upgraded.query('SELECT "id", "title" FROM "Task" WHERE "id" = ?').get("fixture-task")).toEqual(priorTask);
      expect(upgraded.query(`
        SELECT
          o."occurrenceKey",
          o."triggerVersion",
          o."workBlockId",
          w."recurrenceKey" AS "workBlockRecurrenceKey",
          tt."version" AS "triggerVersionAuthority"
        FROM "TaskOccurrence" o
        JOIN "WorkBlock" w ON w."id" = o."workBlockId"
        JOIN "TaskTrigger" tt ON tt."id" = o."triggerId"
        WHERE o."taskId" = 'fixture-task'
      `).all()).toEqual([{
        occurrenceKey: "schedule:v1:2031-01-02T09:00:00.000Z",
        triggerVersion: 1,
        workBlockId: "fixture-legacy-recurrence-block",
        workBlockRecurrenceKey: "schedule:v1:2031-01-02T09:00:00.000Z",
        triggerVersionAuthority: 1,
      }]);
      expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgraded.query("SELECT COUNT(*) AS count FROM _prisma_migrations").get()).toEqual({
        count: Object.keys(metadata.releasedMigrationChecksums).length + 1,
      });
    } finally {
      upgraded.close();
    }
  });
});

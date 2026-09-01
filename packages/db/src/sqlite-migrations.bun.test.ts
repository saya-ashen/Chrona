import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("creates a verified pre-upgrade backup only before pending migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-pre-upgrade-backup-"));
    const migrationsDir = join(dir, "migrations");
    const databasePath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');
    try {
      ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir });
      expect(existsSync(join(dir, "backups", "pre-upgrade"))).toBe(false);
      ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir });
      expect(existsSync(join(dir, "backups", "pre-upgrade"))).toBe(false);

      createMigration(migrationsDir, "20260102000000_add_name", 'ALTER TABLE "Example" ADD COLUMN "name" TEXT;');
      let backupPath: string | undefined;
      const upgrade = ensureSqliteDatabase({
        databaseUrl: `file:${databasePath}`,
        migrationsDir,
        onPreUpgradeBackup: (backup) => { backupPath = backup.backupPath; },
      });
      expect(upgrade.preUpgradeBackup?.backupPath).toBe(backupPath);
      expect(backupPath).toBeTruthy();
      expect(existsSync(backupPath!)).toBe(true);
      expect(existsSync(`${backupPath}.json`)).toBe(true);
      const upgraded = new Database(databasePath, { readonly: true });
      try {
        expect(upgraded.query(`SELECT name FROM pragma_table_info('Example') WHERE name = 'name'`).get()).toBeTruthy();
      } finally {
        upgraded.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create a pre-upgrade backup for explicit reset and fails closed when backup creation fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "chrona-pre-upgrade-failure-"));
    const migrationsDir = join(dir, "migrations");
    const databasePath = join(dir, "chrona.db");
    createMigration(migrationsDir, "20260101000000_init", 'CREATE TABLE "Example" ("id" TEXT NOT NULL PRIMARY KEY);');
    try {
      ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir });
      createMigration(migrationsDir, "20260102000000_add_name", 'ALTER TABLE "Example" ADD COLUMN "name" TEXT;');
      mkdirSync(join(dir, "backups"), { recursive: true });
      writeFileSync(join(dir, "backups", "pre-upgrade"), "block backup creation");
      expect(() => ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir })).toThrow();
      const beforeReset = new Database(databasePath, { readonly: true });
      try {
        expect(beforeReset.query(`SELECT name FROM pragma_table_info('Example') WHERE name = 'name'`).get()).toBeNull();
      } finally {
        beforeReset.close();
      }
      rmSync(join(dir, "backups"), { recursive: true, force: true });
      ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir, reset: true });
      expect(existsSync(join(dir, "backups", "pre-upgrade"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  it("normalizes only the registered pre-amendment legacy release line", () => {
    const migrationsDir = releaseMigrationsDir();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir);
    expect(metadata).toBeTruthy();
    if (!metadata) throw new Error("Expected migration release metadata");

    const dir = mkdtempSync(join(tmpdir(), "chrona-legacy-normalization-"));
    const databasePath = join(dir, "legacy-525.db");
    cpSync(join(migrationsDir, "fixtures", "legacy-525-pre-amendment.sqlite"), databasePath);
    const legacy = new Database(databasePath);
    try {
      legacy.exec(`
        INSERT INTO "Workspace" ("id", "name", "defaultRuntime", "status", "updatedAt")
        VALUES ('legacy-workspace', 'Legacy workspace', 'hermes', 'Active', '2026-08-22T00:00:00.000Z');
        INSERT INTO "Task" ("id", "workspaceId", "title", "executionRuntime", "executionConfig", "status", "priority", "updatedAt")
        VALUES ('legacy-task', 'legacy-workspace', 'Preserve legacy task', 'hermes', '{}', 'Todo', 'Medium', '2026-08-22T00:00:00.000Z');
      `);
    } finally {
      legacy.close();
    }

    ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir });
    const normalized = new Database(databasePath, { readonly: true });
    try {
      expect(schemaFingerprint(normalized)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(normalized.query('SELECT "title" FROM "Task" WHERE "id" = ?').get("legacy-task"))
        .toEqual({ title: "Preserve legacy task" });
      expect(normalized.query('SELECT "entityType", "entityId", "workspaceId", "legacyRuntime", "sourceMigration" FROM "LegacyRuntimeSelectorArchive" ORDER BY "entityType"').all())
        .toEqual([
          { entityType: "task", entityId: "legacy-task", workspaceId: "legacy-workspace", legacyRuntime: "hermes", sourceMigration: metadata.mutableReleaseLineMigration },
          { entityType: "workspace", entityId: "legacy-workspace", workspaceId: "legacy-workspace", legacyRuntime: "hermes", sourceMigration: metadata.mutableReleaseLineMigration },
        ]);
      expect(normalized.query('SELECT name FROM pragma_table_info(\'Task\') WHERE name = \'executionRuntime\'').get()).toBeNull();
      expect(normalized.query('SELECT name FROM pragma_table_info(\'Run\') WHERE name = \'providerConfigFingerprint\'').get()).toBeTruthy();
      expect(normalized.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(normalized.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(normalized.query('SELECT "migration_name", "checksum", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "migration_name"').all())
        .toEqual([
          { migration_name: "0001_initial", checksum: metadata.releasedMigrationHistory["0001_initial"]?.checksum, applied_steps_count: 1 },
          { migration_name: "20260707000000_add_workspace_user_preferences", checksum: metadata.releasedMigrationHistory["20260707000000_add_workspace_user_preferences"]?.checksum, applied_steps_count: 0 },
          { migration_name: metadata.mutableReleaseLineMigration, checksum: checksumSql(readFileSync(join(migrationsDir, metadata.mutableReleaseLineMigration, "migration.sql"), "utf8")), applied_steps_count: 1 },
        ]);
    } finally {
      normalized.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("normalizes the tracked full b46 legacy development history without losing representative records", () => {
    const migrationsDir = releaseMigrationsDir();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir);
    expect(metadata).toBeTruthy();
    if (!metadata) throw new Error("Expected migration release metadata");
    const fixturePath = join(migrationsDir, "fixtures", "legacy-b46-development.sqlite");
    const b46Normalization = metadata.legacyHistoryNormalizations?.[
      "b46d742fdacdc001f371f6ce361ff29b0fd15b8cac25a85bbf40692a1964927b"
    ];
    expect(b46Normalization).toBeTruthy();
    if (!b46Normalization) throw new Error("Expected b46 legacy history normalization metadata");
    expect(checksumSql(readFileSync(fixturePath)))
      .toBe("9d250d95f5d8a6a0668f4e965dab28651518ab9aaf2806746fc2d704b6e565cc");

    const dir = mkdtempSync(join(tmpdir(), "chrona-b46-history-normalization-"));
    const databasePath = join(dir, "b46-copy.db");
    cpSync(fixturePath, databasePath);
    const legacy = new Database(databasePath);
    try {
      expect(schemaFingerprint(legacy)).toBe(b46Normalization.fromSchemaFingerprint);
      legacy.exec(`
        INSERT INTO "Workspace" ("id", "name", "status", "updatedAt")
        VALUES ('b46-workspace', 'B46 workspace', 'Active', '2026-08-22T00:00:00.000Z');
        INSERT INTO "Task" ("id", "workspaceId", "title", "description", "executionConfig", "status", "priority", "updatedAt")
        VALUES ('b46-task', 'b46-workspace', 'Preserve b46 task', 'Full legacy history fixture record', '{"mode":"preserve"}', 'Todo', 'High', '2026-08-22T00:00:00.000Z');
      `);
    } finally {
      legacy.close();
    }

    ensureSqliteDatabase({ databaseUrl: `file:${databasePath}`, migrationsDir });
    const normalized = new Database(databasePath, { readonly: true });
    try {
      expect(schemaFingerprint(normalized)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(normalized.query('SELECT "title", "description", "executionConfig", "priority" FROM "Task" WHERE "id" = ?').get("b46-task"))
        .toEqual({
          title: "Preserve b46 task",
          description: "Full legacy history fixture record",
          executionConfig: '{"mode":"preserve"}',
          priority: "High",
        });
      expect(normalized.query('SELECT 1 FROM "LegacyRuntimeSelectorArchive"').all()).toEqual([]);
      expect(normalized.query('SELECT "migration_name", "checksum", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "migration_name"').all())
        .toEqual([
          { migration_name: "0001_initial", checksum: metadata.releasedMigrationHistory["0001_initial"]?.checksum, applied_steps_count: 1 },
          { migration_name: "20260707000000_add_workspace_user_preferences", checksum: metadata.releasedMigrationHistory["20260707000000_add_workspace_user_preferences"]?.checksum, applied_steps_count: 0 },
          { migration_name: metadata.mutableReleaseLineMigration, checksum: checksumSql(readFileSync(join(migrationsDir, metadata.mutableReleaseLineMigration, "migration.sql"), "utf8")), applied_steps_count: 1 },
        ]);
      expect(normalized.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(normalized.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      normalized.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates immutable v0.2.0 bytes, historical no-op history, fresh convergence, and preserved fixture data", () => {
    const migrationsDir = releaseMigrationsDir();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir);
    expect(metadata).toBeTruthy();
    if (!metadata) throw new Error("Expected migration release metadata");
    expect(checksumSql(readFileSync(join(migrationsDir, "0001_initial", "migration.sql"), "utf8")))
      .toBe("15b1e8b07ba6dbbd351d5e43cedebefd7ce2d0bf2ef5b465bfd241357969971d");
    expect(checksumSql(readFileSync(join(migrationsDir, "20260707000000_add_workspace_user_preferences", "migration.sql"), "utf8")))
      .toBe("d4a4a0ef0ec277b4ecfe94e1840d7120076e18d55dfc4901febc724dbf1bc849");
    expect(checksumSql(readFileSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.path))))
      .toBe(metadata.previousReleaseFixture.sha256);
    const provenance = JSON.parse(readFileSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.provenancePath), "utf8"));
    expect(checksumSql(readFileSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.provenancePath))))
      .toBe(metadata.previousReleaseFixture.provenanceSha256);
    expect(provenance).toMatchObject({
      releaseTag: "v0.2.0",
      releaseAsset: {
        url: "https://github.com/saya-ashen/Chrona/releases/download/v0.2.0/chrona-linux-x64.tar.gz",
        sha256: "4f5933d3b64aad7696d9b1509e6f2dfcfc3efb49b89770cafa9f7c426b988ddf",
      },
      database: {
        path: "data/chrona.db",
        sha256: metadata.previousReleaseFixture.sha256,
        schemaFingerprint: metadata.lastReleasedSchemaFingerprint,
      },
    });

    const dir = mkdtempSync(join(tmpdir(), "chrona-release-migrations-"));
    const freshPath = join(dir, "fresh.db");
    ensureSqliteDatabase({ databaseUrl: `file:${freshPath}`, migrationsDir });
    const fresh = new Database(freshPath, { readonly: true });
    try {
      expect(schemaFingerprint(fresh)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(fresh.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(fresh.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(fresh.query('SELECT "applied_steps_count" FROM "_prisma_migrations" WHERE "migration_name" = ?')
        .get("20260707000000_add_workspace_user_preferences")).toEqual({ applied_steps_count: 0 });
      expect(fresh.query('SELECT 1 FROM "TaskResultContinuation"').all()).toEqual([]);
      expect(fresh.query('SELECT 1 FROM sqlite_master WHERE type = \'index\' AND name = \'TaskPlanTerminalAction_nodeAttemptId_key\'').get()).toBeTruthy();
    } finally {
      fresh.close();
    }

    const upgradePath = join(dir, "upgrade.db");
    cpSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.path), upgradePath);
    const prior = new Database(upgradePath);
    try {
      expect(schemaFingerprint(prior)).toBe(metadata.lastReleasedSchemaFingerprint);
      prior.exec(`
        INSERT INTO "Workspace" ("id", "name", "defaultRuntime", "status", "updatedAt")
        VALUES ('fixture-workspace', 'Fixture workspace', 'hermes', 'Active', '2026-08-22T00:00:00.000Z');
        INSERT INTO "Task" ("id", "workspaceId", "title", "executionRuntime", "executionConfig", "status", "priority", "kind", "recurrenceRule", "recurrenceAnchorStartAt", "recurrenceAnchorEndAt", "recurrenceWindowUntil", "updatedAt")
        VALUES ('fixture-task', 'fixture-workspace', 'Preserve fixture task', 'hermes', '{}', 'Todo', 'Medium', 'recurring', 'FREQ=DAILY;COUNT=1', '2031-01-02T09:00:00.000Z', '2031-01-02T10:00:00.000Z', '2031-07-01T09:00:00.000Z', '2026-08-22T00:00:00.000Z');
        INSERT INTO "WorkBlock" ("id", "workspaceId", "taskId", "recurrenceKey", "title", "status", "scheduledStartAt", "scheduledEndAt", "trigger", "updatedAt")
        VALUES ('fixture-legacy-recurrence-block', 'fixture-workspace', 'fixture-task', '2031-01-02T09:00:00.000Z', 'Preserve fixture task', 'Scheduled', '2031-01-02T09:00:00.000Z', '2031-01-02T10:00:00.000Z', 'manual', '2026-07-23T00:00:00.000Z');
      `);
      expect(prior.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      prior.close();
    }

    ensureSqliteDatabase({ databaseUrl: `file:${upgradePath}`, migrationsDir });
    const upgraded = new Database(upgradePath, { readonly: true });
    try {
      expect(schemaFingerprint(upgraded)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(upgraded.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(upgraded.query('SELECT "title" FROM "Task" WHERE "id" = ?').get("fixture-task"))
        .toEqual({ title: "Preserve fixture task" });
      expect(upgraded.query('SELECT "entityType", "entityId", "workspaceId", "legacyRuntime", "sourceMigration" FROM "LegacyRuntimeSelectorArchive" ORDER BY "entityType"').all())
        .toEqual([
          { entityType: "task", entityId: "fixture-task", workspaceId: "fixture-workspace", legacyRuntime: "hermes", sourceMigration: metadata.mutableReleaseLineMigration },
          { entityType: "workspace", entityId: "fixture-workspace", workspaceId: "fixture-workspace", legacyRuntime: "hermes", sourceMigration: metadata.mutableReleaseLineMigration },
        ]);
      expect(upgraded.query('SELECT "recurrenceKey" FROM "WorkBlock" WHERE "id" = ?').get("fixture-legacy-recurrence-block"))
        .toEqual({ recurrenceKey: "2031-01-02T09:00:00.000Z" });
      expect(upgraded.query('SELECT 1 FROM "TaskResultContinuation"').all()).toEqual([]);
      expect(upgraded.query('SELECT "migration_name", "checksum", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "migration_name"').all())
        .toEqual([
          { migration_name: "0001_initial", checksum: metadata.releasedMigrationHistory["0001_initial"]?.checksum, applied_steps_count: 1 },
          { migration_name: "20260707000000_add_workspace_user_preferences", checksum: metadata.releasedMigrationHistory["20260707000000_add_workspace_user_preferences"]?.checksum, applied_steps_count: 0 },
          { migration_name: metadata.mutableReleaseLineMigration, checksum: checksumSql(readFileSync(join(migrationsDir, metadata.mutableReleaseLineMigration, "migration.sql"), "utf8")), applied_steps_count: 1 },
        ]);
    } finally {
      upgraded.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("baselines only the attested release schema with exact historical applied-step counts", () => {
    const migrationsDir = releaseMigrationsDir();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir);
    expect(metadata).toBeTruthy();
    if (!metadata) throw new Error("Expected migration release metadata");
    const dir = mkdtempSync(join(tmpdir(), "chrona-release-baseline-"));
    const databasePath = join(dir, "baseline.db");
    cpSync(releaseFixturePath(migrationsDir, metadata.previousReleaseFixture.path), databasePath);
    const baseline = new Database(databasePath);
    try {
      baseline.run('DELETE FROM "_prisma_migrations"');
    } finally {
      baseline.close();
    }

    ensureSqliteDatabase({
      databaseUrl: `file:${databasePath}`,
      migrationsDir,
      baselineRelease: metadata.lastReleasedVersion,
    });
    const upgraded = new Database(databasePath, { readonly: true });
    try {
      expect(upgraded.query('SELECT "migration_name", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "migration_name"').all())
        .toEqual([
          { migration_name: "0001_initial", applied_steps_count: 1 },
          { migration_name: "20260707000000_add_workspace_user_preferences", applied_steps_count: 0 },
          { migration_name: metadata.mutableReleaseLineMigration, applied_steps_count: 1 },
        ]);
      expect(schemaFingerprint(upgraded)).toBe(metadata.releaseLineSchemaFingerprint);
    } finally {
      upgraded.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed for altered, unknown, or drifted history before release-line repair", () => {
    const migrationsDir = releaseMigrationsDir();
    const dir = mkdtempSync(join(tmpdir(), "chrona-release-history-rejection-"));
    const releasedPath = join(dir, "released.db");
    cpSync(releaseFixturePath(migrationsDir, "fixtures/v0.2.0-linux-x64.sqlite"), releasedPath);
    const released = new Database(releasedPath);
    released.run('UPDATE "_prisma_migrations" SET "applied_steps_count" = 1 WHERE "migration_name" = ?', ["20260707000000_add_workspace_user_preferences"]);
    released.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${releasedPath}`, migrationsDir }))
      .toThrow("Unrecognized migration history");

    const unknownPath = join(dir, "unknown.db");
    cpSync(join(migrationsDir, "fixtures", "legacy-525-pre-amendment.sqlite"), unknownPath);
    const unknown = new Database(unknownPath);
    unknown.run('UPDATE "_prisma_migrations" SET "applied_steps_count" = 2 WHERE "migration_name" = ?', ["20260729000000_add_ai_feature_runtime_persistence"]);
    unknown.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${unknownPath}`, migrationsDir }))
      .toThrow("Unrecognized migration history");

    const unknownRowPath = join(dir, "unknown-row.db");
    cpSync(releaseFixturePath(migrationsDir, "fixtures/v0.2.0-linux-x64.sqlite"), unknownRowPath);
    const unknownRow = new Database(unknownRowPath);
    unknownRow.run(
      'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "finished_at", "applied_steps_count") VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1)',
      ["unknown-history", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "20990101000000_unknown"],
    );
    unknownRow.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${unknownRowPath}`, migrationsDir }))
      .toThrow("Unrecognized migration history");
    const rejected = new Database(unknownRowPath, { readonly: true });
    try {
      expect(rejected.query('SELECT name FROM pragma_table_info(\'Task\') WHERE name = \'executionRuntime\'').get()).toBeTruthy();
    } finally {
      rejected.close();
    }

    const currentDriftPath = join(dir, "current-schema-drift.db");
    cpSync(releaseFixturePath(migrationsDir, "fixtures/v0.2.0-linux-x64.sqlite"), currentDriftPath);
    const currentDrift = new Database(currentDriftPath);
    currentDrift.run('CREATE TABLE "UnknownCurrentSchemaDrift" ("id" TEXT NOT NULL PRIMARY KEY)');
    currentDrift.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${currentDriftPath}`, migrationsDir }))
      .toThrow("source schema fingerprint is not the recorded 0.2.0 release");

    const driftPath = join(dir, "schema-drift.db");
    cpSync(join(migrationsDir, "fixtures", "legacy-525-pre-amendment.sqlite"), driftPath);
    const drift = new Database(driftPath);
    drift.run('CREATE TABLE "UnknownSchemaDrift" ("id" TEXT NOT NULL PRIMARY KEY)');
    drift.close();
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${driftPath}`, migrationsDir }))
      .toThrow("complete checksum history matched but database schema fingerprint does not match the registered source");
    rmSync(dir, { recursive: true, force: true });
  });

});

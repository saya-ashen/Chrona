import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

test("upgrades the deployed result-files release line without changing existing Task data or released SQL", () => {
  const dir = mkdtempSync(join(tmpdir(), "chrona-work-record-upgrade-")), path = join(dir, "upgrade.sqlite"), fresh = join(dir, "fresh.sqlite");
  const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
  try {
    cpSync(join(migrationsDir, "fixtures/pre-work-records.sqlite"), path);
    const before = new Database(path); before.run('PRAGMA foreign_keys=ON');
    before.run(`INSERT INTO "Workspace" ("id", "name", "status", "updatedAt") VALUES ('work-upgrade', 'Preserved workspace', 'Active', CURRENT_TIMESTAMP)`);
    before.run(`INSERT INTO "Task" ("id", "workspaceId", "title", "taskExecutionMode", "autoExecute", "autoPlanGeneration", "status", "priority", "executionConfig", "updatedAt") VALUES ('preserved-task', 'work-upgrade', 'Keep my record', 'manual', 0, 0, 'Ready', 'Medium', '{}', CURRENT_TIMESTAMP)`);
    const task = before.query('SELECT * FROM "Task" WHERE "id" = ?').get('preserved-task');
    const oldFingerprint = schemaFingerprint(before); before.close();
    const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
    expect(Object.values(metadata.mutableReleaseLineAmendments ?? {}).some(value => value.fromSchemaFingerprint === oldFingerprint)).toBe(true);
    ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    ensureSqliteDatabase({ databaseUrl: `file:${fresh}`, migrationsDir });
    const after = new Database(path), installed = new Database(fresh);
    try {
      expect(after.query('SELECT * FROM "Task" WHERE "id" = ?').get('preserved-task')).toEqual(task);
      expect(schemaFingerprint(after)).toBe(schemaFingerprint(installed));
      expect(schemaFingerprint(after)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(after.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: "ok" });
      expect(after.query('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(after.query('SELECT count(*) as n FROM "WorkRecord"').get()).toEqual({ n: 0 });
      expect(after.query('SELECT count(*) as n FROM "TaskResult"').get()).toEqual({ n: 0 });
    } finally { after.close(); installed.close(); }
    expect(readFileSync(join(migrationsDir, "release-metadata.json"), "utf8")).toContain(oldFingerprint);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

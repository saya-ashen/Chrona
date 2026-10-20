import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureSqliteDatabase } from "../../../packages/db/src/sqlite-migrations";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-module-migration-"));
  return { databaseUrl: `file:${join(root, "test.db")}`, migrationsDir: resolve("prisma/migrations"), root };
}

test("full migration chain creates module tables, unique keys and cascading relations", () => {
  const options = fixture();
  ensureSqliteDatabase(options);
  const db = new Database(join(options.root, "test.db"));
  try {
    db.exec("PRAGMA foreign_keys = ON");
    expect(db.query('SELECT name FROM "_chrona_migrations" ORDER BY name').all()).toEqual(
      ["0001_initial", "0002_labels", "0003_preference_topic", "0004_modules"].map(name => ({ name })),
    );
    for (const [table, parent, column] of [
      ["Module", "Workspace", "workspaceId"], ["Module", "Affair", "affairId"],
      ["ModuleVersion", "Module", "moduleId"], ["ModuleRun", "Module", "moduleId"],
      ["Generation", "Workspace", "workspaceId"], ["Schedule", "Module", "moduleId"],
    ]) {
      expect(db.query(`PRAGMA foreign_key_list("${table}")`).all()).toContainEqual(expect.objectContaining({ table: parent, from: column, on_delete: "CASCADE" }));
    }
    db.exec(`
      INSERT INTO Workspace (id, name, updatedAt) VALUES ('ws', 'Test', CURRENT_TIMESTAMP);
      INSERT INTO Affair (id, workspaceId, title, dirName, updatedAt) VALUES ('affair', 'ws', 'Test', 'test', CURRENT_TIMESTAMP);
      INSERT INTO Module (id, workspaceId, affairId, name) VALUES ('module', 'ws', 'affair', 'watch');
      INSERT INTO ModuleVersion (id, moduleId, hash, manifest, intent, source, report, status) VALUES ('version', 'module', 'hash', '{}', '{}', 'provider', '{}', 'approved');
      INSERT INTO ModuleRun (id, moduleId, hash, triggerId, firedAt, exitCode, executed) VALUES ('run', 'module', 'hash', 'daily', CURRENT_TIMESTAMP, 0, '[]');
      INSERT INTO Generation (id, workspaceId, seq, modules, reason) VALUES ('gen', 'ws', 1, '{"module":"hash"}', 'activate');
      INSERT INTO Schedule (id, workspaceId, affairId, mode, rule, text, createdBy, moduleId, triggerId) VALUES ('schedule', 'ws', 'affair', 'module', '{}', '', 'chrona', 'module', 'daily');
    `);
    expect(() => db.exec("INSERT INTO Module (id, workspaceId, affairId, name) VALUES ('duplicate', 'ws', 'affair', 'watch')")).toThrow();
    expect(() => db.exec("INSERT INTO ModuleVersion (id, moduleId, hash, manifest, intent, source, report, status) SELECT 'duplicate', moduleId, hash, manifest, intent, source, report, status FROM ModuleVersion")).toThrow();
    expect(() => db.exec("INSERT INTO Generation (id, workspaceId, seq, modules, reason) SELECT 'duplicate', workspaceId, seq, modules, reason FROM Generation")).toThrow();
    db.exec("DELETE FROM Affair WHERE id = 'affair'");
    for (const table of ["Module", "ModuleVersion", "ModuleRun", "Schedule"]) expect(db.query(`SELECT * FROM "${table}"`).all()).toEqual([]);
    // Snapshots belong to the workspace, not to the deleted module/affair.
    expect(db.query("SELECT * FROM Generation").all()).toHaveLength(1);
    db.exec("DELETE FROM Workspace WHERE id = 'ws'");
    expect(db.query("SELECT * FROM Generation").all()).toEqual([]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});

test("upgrade pauses only active legacy jobs and preserves other schedules", () => {
  const options = fixture(), prior = join(options.root, "prior");
  for (const name of ["0001_initial", "0002_labels", "0003_preference_topic"]) {
    mkdirSync(join(prior, name), { recursive: true });
    copyFileSync(resolve("prisma/migrations", name, "migration.sql"), join(prior, name, "migration.sql"));
  }
  ensureSqliteDatabase({ ...options, migrationsDir: prior });
  const db = new Database(join(options.root, "test.db"));
  try {
    db.exec(`
      INSERT INTO Workspace (id, name, updatedAt) VALUES ('ws', 'Test', CURRENT_TIMESTAMP);
      INSERT INTO Affair (id, workspaceId, title, dirName, updatedAt) VALUES ('affair', 'ws', 'Test', 'test', CURRENT_TIMESTAMP);
    `);
    for (const [id, mode, status] of [["active-job", "job", "active"], ["done-job", "job", "done"], ["wake", "wake", "active"], ["remind", "remind", "active"]]) {
      db.run("INSERT INTO Schedule (id, workspaceId, affairId, mode, rule, text, createdBy, status, lastResult) VALUES (?, 'ws', 'affair', ?, '{}', '', 'chrona', ?, 'old')", [id!, mode!, status!]);
    }
  } finally { db.close(); }
  ensureSqliteDatabase(options);
  ensureSqliteDatabase(options);
  const upgraded = new Database(join(options.root, "test.db"), { readonly: true });
  try {
    expect(upgraded.query("SELECT id, status, lastResult FROM Schedule ORDER BY id").all()).toEqual([
      { id: "active-job", status: "paused", lastResult: "job 已停用：请改为模块" },
      { id: "done-job", status: "done", lastResult: "old" },
      { id: "remind", status: "active", lastResult: "old" },
      { id: "wake", status: "active", lastResult: "old" },
    ]);
  } finally { upgraded.close(); }
});

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureSqliteDatabase } from "../../../packages/db/src/sqlite-migrations";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "chrona-drop-jobs-migration-"));
  return { databaseUrl: `file:${join(root, "test.db")}`, migrationsDir: resolve("prisma/migrations"), root };
}

test("full migration chain removes obsolete Schedule columns", () => {
  const options = fixture();
  ensureSqliteDatabase(options);
  const db = new Database(join(options.root, "test.db"), { readonly: true });
  try {
    expect(db.query('SELECT name FROM "_chrona_migrations" ORDER BY name').all()).toEqual(
      ["0001_initial", "0002_labels", "0003_preference_topic", "0004_modules", "0005_drop_jobs"].map(name => ({ name })),
    );
    const columns = db.query<{ name: string }, []>('PRAGMA table_info("Schedule")').all().map(column => column.name);
    expect(columns).not.toContain("command");
    expect(columns).not.toContain("lastOutputHash");
    expect(columns).toContain("moduleId");
    expect(columns).toContain("triggerId");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});

test("upgrade deletes every job and preserves all other schedule data, indexes and foreign keys", () => {
  const options = fixture(), prior = join(options.root, "prior");
  for (const name of ["0001_initial", "0002_labels", "0003_preference_topic", "0004_modules"]) {
    mkdirSync(join(prior, name), { recursive: true });
    copyFileSync(resolve("prisma/migrations", name, "migration.sql"), join(prior, name, "migration.sql"));
  }
  ensureSqliteDatabase({ ...options, migrationsDir: prior });
  const db = new Database(join(options.root, "test.db"));
  let rows: unknown[], columns: Record<string, unknown>[], indexes: unknown[], foreignKeys: unknown[];
  try {
    db.exec(`
      INSERT INTO Workspace (id, name, updatedAt) VALUES ('ws', 'Test', CURRENT_TIMESTAMP);
      INSERT INTO Affair (id, workspaceId, title, dirName, updatedAt) VALUES ('affair', 'ws', 'Test', 'test', CURRENT_TIMESTAMP);
      INSERT INTO Module (id, workspaceId, affairId, name) VALUES ('module', 'ws', 'affair', 'watch');
    `);
    for (const status of ["active", "paused", "done", "cancelled"]) {
      db.run("INSERT INTO Schedule (id, workspaceId, affairId, mode, rule, text, command, lastOutputHash, createdBy, status) VALUES (?, 'ws', 'affair', 'job', '{}', '', 'echo old', 'old-hash', 'chrona', ?)", [`job-${status}`, status]);
    }
    for (const mode of ["wake", "remind", "module"]) {
      db.run(`INSERT INTO Schedule (id, workspaceId, affairId, mode, rule, text, moduleId, triggerId, until, status, nextAt, lastAt, lastResult, failures, label, createdBy, createdAt)
        VALUES (?, 'ws', 'affair', ?, '{"kind":"every","minutes":5}', 'Keep text', ?, ?, '2027-01-01', 'active', '2026-10-21', '2026-10-20', 'Keep result', 2, 'Keep label', 'user', '2026-10-19')`,
      [mode, mode, mode === "module" ? "module" : null, mode === "module" ? "daily" : null]);
    }
    rows = db.query('SELECT id, workspaceId, affairId, mode, rule, text, moduleId, triggerId, until, status, nextAt, lastAt, lastResult, failures, label, createdBy, createdAt FROM Schedule WHERE mode != \'job\' ORDER BY id').all();
    columns = db.query<{ cid: number; name: string }, []>('PRAGMA table_info("Schedule")').all().filter(column => !["command", "lastOutputHash"].includes(column.name)).map(({ cid: _cid, ...column }) => column);
    indexes = db.query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Schedule' ORDER BY name").all();
    foreignKeys = db.query('PRAGMA foreign_key_list("Schedule")').all();
  } finally { db.close(); }
  ensureSqliteDatabase(options);
  ensureSqliteDatabase(options);
  const upgraded = new Database(join(options.root, "test.db"));
  try {
    upgraded.exec("PRAGMA foreign_keys = ON");
    expect(upgraded.query("SELECT * FROM Schedule ORDER BY id").all()).toEqual(rows!);
    expect(upgraded.query<{ cid: number }, []>('PRAGMA table_info("Schedule")').all().map(({ cid: _cid, ...column }) => column)).toEqual(columns!);
    expect(upgraded.query("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Schedule' ORDER BY name").all()).toEqual(indexes!);
    expect(upgraded.query('PRAGMA foreign_key_list("Schedule")').all()).toEqual(foreignKeys!);
    upgraded.exec("DELETE FROM Module WHERE id = 'module'");
    expect(upgraded.query("SELECT id FROM Schedule ORDER BY id").all()).toEqual([{ id: "remind" }, { id: "wake" }]);
    upgraded.exec("DELETE FROM Affair WHERE id = 'affair'");
    expect(upgraded.query("SELECT * FROM Schedule").all()).toEqual([]);
    expect(upgraded.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { upgraded.close(); }
});

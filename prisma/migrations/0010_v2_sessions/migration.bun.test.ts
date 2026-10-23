import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSqliteDatabase } from "../../../packages/db/src/sqlite-migrations";

test("session migration applies through the production runner with foreign keys enabled", () => {
  const root = mkdtempSync(join(tmpdir(), "chrona-v2-sessions-"));
  const path = join(root, "test.sqlite");
  try {
    ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir: fileURLToPath(new URL("../", import.meta.url)) });
    const db = new Database(path);
    try {
      const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
      expect(tables).toContain("Session");
      expect(tables).not.toContain("Affair");
      expect(tables).not.toContain("Activity");
      expect(db.query("PRAGMA table_info(Message)").all()).toContainEqual(expect.objectContaining({ name: "sessionId", notnull: 1 }));
      expect(db.query("PRAGMA table_info(Module)").all()).toContainEqual(expect.objectContaining({ name: "builtin" }));
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
    // Re-running startup verifies the recorded checksums without reapplying DDL.
    expect(() => ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir: fileURLToPath(new URL("../", import.meta.url)) })).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

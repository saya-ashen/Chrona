import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

test("dropping executed preserves run history and indexes", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE ModuleRun (id TEXT PRIMARY KEY, moduleId TEXT NOT NULL, hash TEXT NOT NULL, firedAt DATETIME NOT NULL, executed JSONB NOT NULL);
      CREATE INDEX ModuleRun_moduleId_hash_firedAt_idx ON ModuleRun(moduleId, hash, firedAt);
      INSERT INTO ModuleRun VALUES ('run', 'module', 'hash', '2026-10-20', '[]');`);
    db.exec(readFileSync(new URL("./migration.sql", import.meta.url), "utf8"));
    expect(db.query("PRAGMA table_info(ModuleRun)").all()).not.toContainEqual(expect.objectContaining({ name: "executed" }));
    expect(db.query("SELECT * FROM ModuleRun").all()).toEqual([{ id: "run", moduleId: "module", hash: "hash", firedAt: "2026-10-20" }]);
    expect(db.query("PRAGMA index_list(ModuleRun)").all()).toContainEqual(expect.objectContaining({ name: "ModuleRun_moduleId_hash_firedAt_idx" }));
  } finally { db.close(); }
});

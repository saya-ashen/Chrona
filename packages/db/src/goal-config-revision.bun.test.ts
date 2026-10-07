import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";
import { createDevelopmentFixture } from "./sqlite-development-fixture.test-support";

const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
function seed(db: Database) {
  db.run(`INSERT INTO Workspace (id,name,status,createdAt,updatedAt) VALUES ('workspace','Preserve','Active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  db.run(`INSERT INTO Goal (id,workspaceId,title,successCriteria,status,createdAt,updatedAt) VALUES ('goal','workspace','Original','[]','Paused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
}
function withPath(test: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "chrona-goal-revision-"));
  try { test(join(dir, "chrona.db")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("Goal configuration revision migration", () => {
  it("normalizes the exact pre-Goal-revision development history, backs up, and preserves existing Goals", () => withPath((path) => {
    createDevelopmentFixture(path, "manual");
    const old = new Database(path);
    seed(old); old.close();
    const result = ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    expect(result.preUpgradeBackup).toBeTruthy();
    const db = new Database(path);
    try {
      expect(schemaFingerprint(db)).toBe(metadata.releaseLineSchemaFingerprint);
      expect(db.query('SELECT title,status,successCriteria,configRevision FROM Goal WHERE id=?').get("goal")).toEqual({ title: "Original", status: "Paused", successCriteria: "[]", configRevision: 1 });
      expect(db.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: "ok" });
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
    expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
  }));

  it("fresh installs invalidate A→B→A and lifecycle/criteria/brief writes independently of timestamps", () => withPath((path) => {
    ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
    const db = new Database(path);
    try {
      seed(db);
      const version = () => (db.query('SELECT configRevision FROM Goal WHERE id=?').get("goal") as { configRevision: number }).configRevision;
      const timestamp = db.query('SELECT updatedAt FROM Goal WHERE id=?').get("goal");
      expect(version()).toBe(1);
      db.run("UPDATE Goal SET title='Intermediate' WHERE id='goal'");
      db.run("UPDATE Goal SET title='Original' WHERE id='goal'");
      expect(version()).toBe(3);
      expect(db.query('SELECT updatedAt FROM Goal WHERE id=?').get("goal")).toEqual(timestamp);
      db.run("UPDATE Goal SET title='Original' WHERE id='goal'");
      expect(version()).toBe(3);
      db.run("UPDATE Goal SET status='Active', operationalBrief='{}', successCriteria='[{}]' WHERE id='goal'");
      expect(version()).toBe(4);
      db.run("UPDATE Goal SET configRevision=configRevision+1 WHERE id='goal'");
      expect(version()).toBe(5);
    } finally { db.close(); }
  }));
});

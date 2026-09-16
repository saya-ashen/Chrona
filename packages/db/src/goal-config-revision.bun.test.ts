import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
const checksum = "5d2fdbd183363bc9d069efc0936ff8584b70c8bc06e4b3f1e89b9728fff4544a";
const current = readFileSync(join(migrationsDir, metadata.mutableReleaseLineMigration, "migration.sql"), "utf8");
const prior = current.slice(0, current.indexOf("\n-- Goal editing:"));
function seed(db: Database) {
  db.run(`INSERT INTO Workspace (id,name,status,createdAt,updatedAt) VALUES ('workspace','Preserve','Active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  db.run(`INSERT INTO Goal (id,workspaceId,title,successCriteria,status,createdAt,updatedAt) VALUES ('goal','workspace','Original','[]','Paused',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
}
function withPath(test: (path: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "chrona-goal-revision-"));
  try { test(join(dir, "chrona.db")); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("Goal configuration revision migration", () => {
  it("upgrades the exact deployed mutable checksum, backs up, and preserves existing Goals", () => withPath((path) => {
    expect(checksumSql(prior)).toBe(checksum);
    cpSync(join(migrationsDir, metadata.previousReleaseFixture.path), path);
    const old = new Database(path);
    old.run(prior);
    old.run("INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,1)", ["previous-goal-line", checksum, new Date().toISOString(), metadata.mutableReleaseLineMigration, new Date().toISOString()]);
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

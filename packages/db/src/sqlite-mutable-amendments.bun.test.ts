import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { checksumSql, ensureSqliteDatabase, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";
import { verifyMutableAmendments } from "./sqlite-mutable-amendments";

const migrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
const metadata = verifyMigrationReleaseMetadata(migrationsDir)!;
const previousChecksum = "641aa4b5907177ca6857c659a3ddb8fa8b7ed3d14c975f026ba250296e36675e";
const currentSql = readFileSync(join(migrationsDir, metadata.mutableReleaseLineMigration, "migration.sql"), "utf8");
// Keep the source fixture reproducible without duplicating the 80 KB migration.
// The checksum prevents this prefix fixture from silently changing with future edits.
const previousSql = currentSql.slice(0, currentSql.indexOf("\n-- Management MCP:"));
function priorDatabase(path: string) {
  expect(checksumSql(previousSql)).toBe(previousChecksum);
  cpSync(join(migrationsDir, metadata.previousReleaseFixture.path), path);
  const db = new Database(path);
  db.run(previousSql);
  db.run("INSERT INTO _prisma_migrations (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,1)", ["previous-line", previousChecksum, new Date().toISOString(), metadata.mutableReleaseLineMigration, new Date().toISOString()]);
  db.run(`INSERT INTO "Workspace" (id,name,status,createdAt,updatedAt) VALUES ('amendment-preserve','Preserve','Active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
  return db;
}

describe("registered mutable release amendments", () => {
  it("upgrades known unreleased history, preserves data and backs up before touching schema", () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-amendment-"));
    const path = join(root, "chrona.db");
    try {
      priorDatabase(path).close();
      const result = ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir });
      expect(result.preUpgradeBackup).toBeTruthy();
      const db = new Database(path);
      try {
        expect(schemaFingerprint(db)).toBe(metadata.releaseLineSchemaFingerprint);
        expect(db.query('SELECT name FROM "Workspace" WHERE id = ?').get("amendment-preserve")).toEqual({ name: "Preserve" });
        expect(db.query("SELECT checksum FROM _prisma_migrations WHERE migration_name = ?").get(metadata.mutableReleaseLineMigration)).toEqual({ checksum: checksumSql(currentSql) });
      } finally { db.close(); }
      expect(ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir }).preUpgradeBackup).toBeNull();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects schema drift even with a registered old checksum, without partial amendment", () => {
    const root = mkdtempSync(join(tmpdir(), "chrona-amendment-drift-"));
    const path = join(root, "chrona.db");
    try {
      const before = priorDatabase(path);
      before.run("CREATE TABLE Unregistered (id TEXT)");
      before.close();
      expect(() => ensureSqliteDatabase({ databaseUrl: `file:${path}`, migrationsDir })).toThrow("source schema mismatch");
      const after = new Database(path);
      try { expect(after.query("SELECT name FROM sqlite_master WHERE name = 'ManagementClient'").get()).toBeNull(); }
      finally { after.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects altered amendment paths and hashes", () => {
    const entry = metadata.mutableReleaseLineAmendments![previousChecksum];
    expect(() => verifyMutableAmendments({ ...metadata, mutableReleaseLineAmendments: { [previousChecksum]: { ...entry, path: "../../elsewhere.sql" } } }, migrationsDir)).toThrow();
    expect(() => verifyMutableAmendments({ ...metadata, mutableReleaseLineAmendments: { [previousChecksum]: { ...entry, sha256: "0".repeat(64) } } }, migrationsDir)).toThrow();
  });
});

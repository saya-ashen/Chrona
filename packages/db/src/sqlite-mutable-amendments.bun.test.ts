import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { checksumSql, schemaFingerprint } from "./sqlite-schema-fingerprint";
import { applyMutableAmendment, recognizedMutableHistory, verifyMutableAmendments } from "./sqlite-mutable-amendments";

function withAmendment(test: (fixture: ReturnType<typeof createAmendment>) => void) {
  const fixture = createAmendment();
  try { test(fixture); } finally {
    fixture.db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

// Synthetic, unpublished line: a shipped checksum must never be treated as mutable.
function createAmendment() {
  const root = mkdtempSync(join(tmpdir(), "chrona-mutable-amendment-"));
  const db = new Database(":memory:");
  const sourceSql = 'CREATE TABLE Example (id TEXT PRIMARY KEY);';
  const sql = 'ALTER TABLE Example ADD COLUMN title TEXT;';
  const previousChecksum = checksumSql(sourceSql);
  const currentChecksum = checksumSql(sourceSql + sql);
  const migration = "20300101000000_unreleased";
  const path = `${migration}/amendments/${previousChecksum}.sql`;
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), sql);
  db.run(sourceSql);
  const fromSchemaFingerprint = schemaFingerprint(db);
  db.run("CREATE TABLE _prisma_migrations (migration_name TEXT, checksum TEXT, applied_steps_count INTEGER)");
  db.run("INSERT INTO _prisma_migrations VALUES (?, ?, 1)", [migration, previousChecksum]);
  db.run("INSERT INTO Example (id) VALUES ('preserve')");
  const target = new Database(":memory:");
  target.run(sourceSql + sql);
  const releaseLineSchemaFingerprint = schemaFingerprint(target);
  target.close();
  const entry = { fromSchemaFingerprint, path, sha256: checksumSql(sql) };
  const metadata = {
    mutableReleaseLineMigration: migration, releaseLineSchemaFingerprint,
    releasedMigrationHistory: {}, mutableReleaseLineAmendments: { [previousChecksum]: entry },
  };
  return { root, db, previousChecksum, currentChecksum, metadata, entry };
}

describe("registered mutable release amendments", () => {
  it("amends only exact unpublished history and preserves data", () => withAmendment((f) => {
    const history = new Map([[f.metadata.mutableReleaseLineMigration, { checksum: f.previousChecksum, applied_steps_count: 1 }]]);
    expect(recognizedMutableHistory(history, f.metadata)).toBe(true);
    expect(recognizedMutableHistory(new Map([...history, ["unknown", { checksum: f.previousChecksum, applied_steps_count: 1 }]]), f.metadata)).toBe(false);
    applyMutableAmendment(f.db, f.metadata, f.root, f.currentChecksum);
    expect(schemaFingerprint(f.db)).toBe(f.metadata.releaseLineSchemaFingerprint);
    expect(f.db.query("SELECT * FROM Example").all()).toEqual([{ id: "preserve", title: null }]);
    expect(f.db.query("SELECT checksum FROM _prisma_migrations").get()).toEqual({ checksum: f.currentChecksum });
    applyMutableAmendment(f.db, f.metadata, f.root, f.currentChecksum);
  }));

  it("rejects source drift before SQL and rolls back a wrong target", () => withAmendment((f) => {
    f.db.run("CREATE TABLE Unregistered (id TEXT)");
    expect(() => applyMutableAmendment(f.db, f.metadata, f.root, f.currentChecksum)).toThrow("source schema mismatch");
    f.db.run("DROP TABLE Unregistered");
    expect(() => applyMutableAmendment(f.db, { ...f.metadata, releaseLineSchemaFingerprint: "0".repeat(64) }, f.root, f.currentChecksum)).toThrow("target schema mismatch");
    expect(f.db.query("SELECT name FROM pragma_table_info('Example') WHERE name = 'title'").get()).toBeNull();
    expect(f.db.query("SELECT checksum FROM _prisma_migrations").get()).toEqual({ checksum: f.previousChecksum });
  }));

  it("rejects altered paths, hashes, and any published checksum as an amendment source", () => withAmendment((f) => {
    const changed = (patch: Partial<typeof f.entry>) => ({ ...f.metadata, mutableReleaseLineAmendments: { [f.previousChecksum]: { ...f.entry, ...patch } } });
    expect(() => verifyMutableAmendments(changed({ path: "../../elsewhere.sql" }), f.root)).toThrow();
    expect(() => verifyMutableAmendments(changed({ sha256: "0".repeat(64) }), f.root)).toThrow();
    expect(() => verifyMutableAmendments({ ...f.metadata, releasedMigrationHistory: { published: { checksum: f.previousChecksum, appliedStepsCount: 1 } } }, f.root)).toThrow("released migration checksum cannot be a mutable amendment source");
  }));
});

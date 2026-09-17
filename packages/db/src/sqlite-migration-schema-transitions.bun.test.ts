import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { assertMigrationSchemaTransition, isMigrationSchemaTransitions } from "./sqlite-migration-schema-transitions";
import { schemaFingerprint } from "./sqlite-schema-fingerprint";

const repair = "20260822000000_repair_release_line";

describe("migration-specific schema boundaries", () => {
  it("validates untrusted optional metadata", () => {
    expect(isMigrationSchemaTransitions(undefined)).toBe(true);
    expect(isMigrationSchemaTransitions({})).toBe(true);
    for (const value of [null, [], "invalid", { migration: null }, { migration: {} }, { migration: { fromSchemaFingerprint: "0".repeat(64), toSchemaFingerprint: "invalid" } }]) {
      expect(isMigrationSchemaTransitions(value)).toBe(false);
    }
  });

  it("does not move historical boundaries when latest release advances", () => {
    const db = new Database(":memory:");
    const source = schemaFingerprint(db);
    db.run("CREATE TABLE Example (id TEXT)");
    const target = schemaFingerprint(db);
    const metadata = {
      lastReleasedSchemaFingerprint: target, releaseLineSchemaFingerprint: "0".repeat(64),
      migrationSchemaTransitions: { [repair]: { fromSchemaFingerprint: source, toSchemaFingerprint: target } },
    };
    try {
      expect(isMigrationSchemaTransitions(metadata.migrationSchemaTransitions)).toBe(true);
      expect(() => assertMigrationSchemaTransition(db, metadata, repair, "target")).not.toThrow();
      expect(() => assertMigrationSchemaTransition(db, metadata, repair, "source")).toThrow("source schema fingerprint mismatch");
      db.run("DROP TABLE Example");
      expect(() => assertMigrationSchemaTransition(db, metadata, repair, "source")).not.toThrow();
      expect(() => assertMigrationSchemaTransition(db, metadata, repair, "target")).toThrow("target schema fingerprint mismatch");
    } finally { db.close(); }
  });

  it("preserves format-v1 fallback only when no explicit boundary map exists", () => {
    const db = new Database(":memory:");
    try {
      const source = schemaFingerprint(db);
      const metadata = { lastReleasedSchemaFingerprint: source, releaseLineSchemaFingerprint: "0".repeat(64) };
      expect(() => assertMigrationSchemaTransition(db, metadata, repair, "source")).not.toThrow();
      expect(() => assertMigrationSchemaTransition(db, metadata, repair, "target")).toThrow("target schema fingerprint mismatch");
      expect(() => assertMigrationSchemaTransition(db, undefined, repair, "target")).not.toThrow();
      expect(() => assertMigrationSchemaTransition(db, metadata, "unrelated", "target")).not.toThrow();
      expect(() => assertMigrationSchemaTransition(db, { ...metadata, migrationSchemaTransitions: {} }, repair, "target")).not.toThrow();
    } finally { db.close(); }
  });
});

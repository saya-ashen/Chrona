import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { checksumSql, schemaFingerprint } from "./sqlite-schema-fingerprint";

export type MutableAmendments = Record<string, { fromSchemaFingerprint: string; path: string; sha256: string }>;
type Metadata = {
  mutableReleaseLineMigration: string;
  mutableReleaseLineAmendments?: MutableAmendments;
  releasedMigrationHistory: Record<string, { checksum: string; appliedStepsCount: number }>;
  releaseLineSchemaFingerprint: string;
};

export function verifyMutableAmendments(metadata: Metadata, root: string) {
  for (const [checksum, entry] of Object.entries(metadata.mutableReleaseLineAmendments ?? {})) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Metadata comes from a JSON file, not a trusted typed caller.
    if (!/^[a-f0-9]{64}$/.test(checksum) || !entry ||
        !/^[a-f0-9]{64}$/.test(entry.fromSchemaFingerprint) ||
        entry.path !== `${metadata.mutableReleaseLineMigration}/amendments/${checksum}.sql` ||
        checksumSql(readFileSync(join(root, entry.path))) !== entry.sha256) {
      throw new Error("Invalid mutable release-line amendment");
    }
  }
}

export function recognizedMutableHistory(
  actual: Map<string, { checksum: string; applied_steps_count: number }>, metadata: Metadata,
) {
  const applied = actual.get(metadata.mutableReleaseLineMigration);
  return Boolean(applied && applied.applied_steps_count === 1 &&
    Object.hasOwn(metadata.mutableReleaseLineAmendments ?? {}, applied.checksum) &&
    actual.size === Object.keys(metadata.releasedMigrationHistory).length + 1 &&
    Object.entries(metadata.releasedMigrationHistory).every(([name, entry]) =>
      actual.get(name)?.checksum === entry.checksum && actual.get(name)?.applied_steps_count === entry.appliedStepsCount));
}

export function applyMutableAmendment(db: Database, metadata: Metadata, root: string, targetChecksum: string) {
  const applied = db.query("SELECT checksum FROM _prisma_migrations WHERE migration_name = ?").get(metadata.mutableReleaseLineMigration) as { checksum: string } | null;
  if (!applied || applied.checksum === targetChecksum) return;
  const entry = metadata.mutableReleaseLineAmendments?.[applied.checksum];
  if (!entry) return;
  verifyMutableAmendments(metadata, root);
  db.transaction(() => {
    if (schemaFingerprint(db) !== entry.fromSchemaFingerprint) throw new Error("Mutable amendment source schema mismatch");
    db.run(readFileSync(join(root, entry.path), "utf8"));
    if (db.query("PRAGMA foreign_key_check").get()) throw new Error("Mutable amendment foreign key violation");
    if (schemaFingerprint(db) !== metadata.releaseLineSchemaFingerprint) throw new Error("Mutable amendment target schema mismatch");
    db.run("UPDATE _prisma_migrations SET checksum = ? WHERE migration_name = ?", [targetChecksum, metadata.mutableReleaseLineMigration]);
  })();
}

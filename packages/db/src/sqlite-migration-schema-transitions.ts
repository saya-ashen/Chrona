import type { Database } from "bun:sqlite";
import { schemaFingerprint } from "./sqlite-schema-fingerprint";

export type MigrationSchemaTransitions = Record<string, {
  fromSchemaFingerprint: string;
  toSchemaFingerprint: string;
}>;

type Metadata = {
  migrationSchemaTransitions?: MigrationSchemaTransitions;
  lastReleasedSchemaFingerprint: string;
  releaseLineSchemaFingerprint: string;
};

export function isMigrationSchemaTransitions(value: unknown): value is MigrationSchemaTransitions | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([name, entry]: [string, unknown]) => {
    if (!name || !entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const item = entry as Record<string, unknown>;
    return typeof item.fromSchemaFingerprint === "string" && /^[a-f0-9]{64}$/.test(item.fromSchemaFingerprint) &&
      typeof item.toSchemaFingerprint === "string" && /^[a-f0-9]{64}$/.test(item.toSchemaFingerprint);
  });
}

/** Pin each release transition to its own source/target, not to a moving latest release. */
export function assertMigrationSchemaTransition(
  db: Database, metadata: Metadata | undefined, migrationName: string, phase: "source" | "target",
): void {
  if (!metadata) return;
  const transition = metadata.migrationSchemaTransitions?.[migrationName] ??
    // Retain format-v1 metadata compatibility for the original v0.2 upgrade.
    (metadata.migrationSchemaTransitions === undefined && migrationName === "20260822000000_repair_release_line"
      ? { fromSchemaFingerprint: metadata.lastReleasedSchemaFingerprint, toSchemaFingerprint: metadata.releaseLineSchemaFingerprint }
      : undefined);
  if (!transition) return;
  const expected = phase === "source" ? transition.fromSchemaFingerprint : transition.toSchemaFingerprint;
  if (schemaFingerprint(db) !== expected) {
    throw new Error(`Cannot apply ${migrationName}: ${phase} schema fingerprint mismatch with the recorded migration boundary.`);
  }
}

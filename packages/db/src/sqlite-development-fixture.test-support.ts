import { Database } from "bun:sqlite";
import { cpSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checksumSql, schemaFingerprint, verifyMigrationReleaseMetadata } from "./sqlite-migrations";

export const releaseMigrationsDir = resolve(import.meta.dir, "../../../prisma/migrations");
export const publishedRepairMigration = "20260822000000_repair_release_line";
export const developmentChecksums = {
  management: "54c4449d8a6e186e3c3029f8e611937aa72f36e3309ac04e7d08e6cf6124f6fd",
  manual: "5d2fdbd183363bc9d069efc0936ff8584b70c8bc06e4b3f1e89b9728fff4544a",
  current: "7ae6d8acce6c79fa383ade0b1f766ab276920c9f752d886d2a6b4be8136bd55c",
} as const;

/** Reproduce known development bytes without maintaining multiple binary fixtures. */
export function createDevelopmentFixture(path: string, stage: keyof typeof developmentChecksums): void {
  const metadata = verifyMigrationReleaseMetadata(releaseMigrationsDir)!;
  const suffix = readFileSync(join(releaseMigrationsDir, "fixtures/development-work-management.sql"), "utf8");
  const end = stage === "management" ? suffix.indexOf("\n-- Phase 2A:")
    : stage === "manual" ? suffix.indexOf("\n-- Goal editing:") : suffix.length;
  if (end < 0) throw new Error("Missing frozen development fixture boundary");
  const sql = suffix.slice(0, end);
  const published = readFileSync(join(releaseMigrationsDir, publishedRepairMigration, "migration.sql"), "utf8");
  const checksum = developmentChecksums[stage];
  if (checksumSql(published + sql) !== checksum) throw new Error("Development fixture bytes changed");
  cpSync(join(releaseMigrationsDir, "fixtures/v0.3.1-linux-x64.sqlite"), path);
  const db = new Database(path);
  try {
    db.run(sql);
    db.run("UPDATE _prisma_migrations SET checksum = ? WHERE migration_name = ?", [checksum, publishedRepairMigration]);
    if (schemaFingerprint(db) !== metadata.legacyHistoryNormalizations?.[checksum]?.fromSchemaFingerprint) {
      throw new Error("Development fixture schema changed");
    }
  } finally { db.close(); }
}

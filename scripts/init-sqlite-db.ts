#!/usr/bin/env bun
import { resolve } from "node:path";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";

const args = process.argv.slice(2);
const paths = args;
if (paths.length !== 1 || paths[0].startsWith("--")) {
  console.error("Usage: bun scripts/init-sqlite-db.ts <db-path>");
  process.exit(1);
}
const databaseUrl = `file:${resolve(paths[0])}`;
const lock = acquireSqliteRuntimeLock(databaseUrl);
try {
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dirname, "../prisma/migrations") });
} finally {
  lock.release();
}

import { resolve } from "node:path";
import type { PrismaClient } from "@chrona/db";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { recoverInterruptedSqliteRestore } from "@chrona/db/sqlite-backup";
import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";
import { secureGeneratedSqliteSidecars } from "@chrona/db/sqlite-url";

export async function ensureDefaultWorkspace(db: PrismaClient) {
  await db.workspace.upsert({ where: { id: "ws_default" }, create: { id: "ws_default", name: "Personal" }, update: {} });
}

/** Initialize storage before importing the Prisma-backed runtime graph. */
export async function prepareChronaRuntime(options: { databaseUrl: string; port?: number; onError?: (error: unknown) => void;
  log?: (message: string) => void }) {
  const databaseLock = acquireSqliteRuntimeLock(options.databaseUrl);
  const release = () => databaseLock.release();
  process.once("exit", release);
  let db: PrismaClient | undefined;
  try {
    recoverInterruptedSqliteRestore(options.databaseUrl);
    ensureSqliteDatabase({ databaseUrl: options.databaseUrl, migrationsDir: process.env.CHRONA_MIGRATIONS_DIR ?? resolve("packages/db/prisma/migrations"), log: options.log });
    db = (await import("@chrona/db/db")).db;
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    await db.$queryRawUnsafe("SELECT 1");
    await ensureDefaultWorkspace(db);
    secureGeneratedSqliteSidecars(options.databaseUrl);
    const { createStewardRuntime } = await import("../../server/src/steward-runtime");
    const steward = createStewardRuntime(db, { port: options.port, onError: options.onError });
    return { steward, async stop() {
      await steward.stop();
      try { await db!.$disconnect(); }
      finally { process.off("exit", release); release(); }
    } };
  } catch (error) {
    try { await db?.$disconnect(); }
    finally { process.off("exit", release); release(); }
    throw error;
  }
}

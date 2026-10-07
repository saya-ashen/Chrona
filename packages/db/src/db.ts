import { PrismaClient } from "@/generated/prisma/client";
import { inDatabaseTransaction, transactionAwareClient } from "./transaction-context";
import { guardSqliteAdapter } from "./sqlite-adapter-guards";
export { afterDatabaseCommit } from "./transaction-context";
import { applyChronaRuntimeConfigToEnv } from "@chrona/shared/runtime-config";
import { resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { ensureSqliteDatabase } from "./sqlite-migrations";
import { AUTO_TEST_DATABASE_ENV, resolveRuntimeDatabaseUrl, resolveSqliteAdapterUrl } from "./sqlite-url";

applyChronaRuntimeConfigToEnv(process.env);

const DATABASE_URL = resolveRuntimeDatabaseUrl(process.env);
const MIGRATIONS_DIR = process.env.CHRONA_MIGRATIONS_DIR ?? resolve("prisma", "migrations");

if (typeof globalThis.Bun === "undefined") {
  throw new Error(
    "Chrona database runtime requires Bun. " +
    "Please run Chrona through the portable binary or with Bun.",
  );
}

function createAdapter() {
  return guardSqliteAdapter(new PrismaBunSqlite({
    url: resolveSqliteAdapterUrl(DATABASE_URL),
  }));
}

function createDbClient() {
  if (process.env.NODE_ENV === "test") {
    ensureSqliteDatabase({
      databaseUrl: DATABASE_URL,
      migrationsDir: MIGRATIONS_DIR,
      reset: process.env[AUTO_TEST_DATABASE_ENV] === "1",
    });
  }

  const adapter = createAdapter();

  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  // Prisma adapter connections inherit this for subsequent operations in Bun SQLite.
  client.$executeRawUnsafe("PRAGMA foreign_keys = ON").catch(() => undefined);

  return client;
}

function hasRequiredDelegates(client: PrismaClient | undefined) {
  if (!client) {
    return false;
  }

  return typeof (client as PrismaClient & { taskSession?: unknown }).taskSession === "object";
}

function resolveCachedClient(globalForPrisma: typeof globalThis & {
  prisma?: PrismaClient;
}) {
  const cachedClient = globalForPrisma.prisma;
  if (hasRequiredDelegates(cachedClient)) {
    return cachedClient;
  }

  if (cachedClient) {
    globalForPrisma.prisma = undefined;
  }
  return undefined;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const rootDb = resolveCachedClient(globalForPrisma) ?? createDbClient();
export const db = transactionAwareClient(rootDb);
export function withDatabaseTransaction<T>(work: () => Promise<T>): Promise<T> {
  return inDatabaseTransaction(rootDb, work);
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = rootDb;
}

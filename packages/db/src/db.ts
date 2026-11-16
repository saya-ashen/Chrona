import { PrismaClient } from "@/generated/prisma/client";
import { inDatabaseTransaction, transactionAwareClient } from "./transaction-context";
import { guardSqliteAdapter } from "./sqlite-adapter-guards";
export { afterDatabaseCommit } from "./transaction-context";
import { applyChronaRuntimeConfigToEnv } from "@chrona/shared/runtime-config";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { ensureSqliteDatabase } from "./sqlite-migrations";
import { resolveRuntimeDatabaseUrl, resolveSqliteAdapterUrl } from "./sqlite-url";

applyChronaRuntimeConfigToEnv(process.env);

if (typeof globalThis.Bun === "undefined") {
  throw new Error(
    "Chrona database runtime requires Bun. " +
    "Please run Chrona through the portable binary or with Bun.",
  );
}

let ephemeralTestRoot: string | undefined;

function resolveEffectiveDatabaseUrl(): string {
  if (
    process.env.NODE_ENV === "test" &&
    !process.env.DATABASE_URL?.trim() &&
    !process.env.CHRONA_DATA_DIR?.trim()
  ) {
    if (!ephemeralTestRoot) {
      ephemeralTestRoot = mkdtempSync(join(tmpdir(), "chrona-ephemeral-test-db-"));
      const dirToClean = ephemeralTestRoot;
      process.once("exit", () => {
        rmSync(dirToClean, { recursive: true, force: true });
      });
    }
    return `file:${join(ephemeralTestRoot, "test.db")}`;
  }
  return resolveRuntimeDatabaseUrl(process.env);
}

function createAdapter(databaseUrl: string) {
  return guardSqliteAdapter(new PrismaBunSqlite({
    url: resolveSqliteAdapterUrl(databaseUrl),
    // Keep committed receipts durable while avoiding rollback-journal fsyncs on
    // every routed call. Configure every adapter connection, including reopen.
    wal: { enabled: true, synchronous: "FULL", busyTimeout: 5000 },
  }));
}

function createDbClient() {
  const databaseUrl = resolveEffectiveDatabaseUrl();
  const migrationsDir = process.env.CHRONA_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../../../prisma/migrations");
  if (process.env.NODE_ENV === "test") {
    ensureSqliteDatabase({
      databaseUrl,
      migrationsDir,
    });
  }

  const adapter = createAdapter(databaseUrl);

  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  return client;
}

function hasRequiredDelegates(client: PrismaClient | undefined) {
  if (!client) {
    return false;
  }

  return typeof client.session === "object";
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

let initializedRootDb: PrismaClient | undefined;
let initializedAwareDb: PrismaClient | undefined;
const boundAwareMethods = new Map<PropertyKey, unknown>();

function getRootDb(): PrismaClient {
  if (!initializedRootDb) {
    initializedRootDb = resolveCachedClient(globalForPrisma) ?? createDbClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = initializedRootDb;
    }
  }
  return initializedRootDb;
}

function getAwareDb(): PrismaClient {
  if (!initializedAwareDb) {
    initializedAwareDb = transactionAwareClient(getRootDb());
  }
  return initializedAwareDb;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getAwareDb();
    const value = Reflect.get(client, property);
    if (typeof value !== "function") return value;
    if (property === "$transaction") return value;
    let bound = boundAwareMethods.get(property);
    if (!bound) {
      bound = value.bind(client);
      boundAwareMethods.set(property, bound);
    }
    return bound;
  },
  set(_target, property, value) {
    boundAwareMethods.delete(property);
    return Reflect.set(getAwareDb(), property, value);
  },
  has(_target, property) {
    return Reflect.has(getAwareDb(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(getAwareDb());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(getAwareDb(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});

export function withDatabaseTransaction<T>(work: () => Promise<T>): Promise<T> {
  return inDatabaseTransaction(getRootDb(), work);
}

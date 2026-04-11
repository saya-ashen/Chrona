import { PrismaClient } from "@/generated/prisma/client";

import { resolveSqliteAdapterUrl } from "@/lib/db-url";

const DATABASE_URL = process.env.DATABASE_URL || "file:./prisma/dev.db";

async function createAdapter() {
  if (typeof globalThis.Bun !== "undefined") {
    const { PrismaBunSqlite } = await import("prisma-adapter-bun-sqlite");

    return new PrismaBunSqlite({
      url: resolveSqliteAdapterUrl(DATABASE_URL, "bun"),
    });
  }

  const { PrismaBetterSqlite3 } = await import("@prisma/adapter-better-sqlite3");

  return new PrismaBetterSqlite3({
    url: resolveSqliteAdapterUrl(DATABASE_URL, "node"),
  });
}

async function createDbClient() {
  const adapter = await createAdapter();

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function hasRequiredDelegates(client: PrismaClient | undefined) {
  if (!client) {
    return false;
  }

  return typeof (client as PrismaClient & { taskSession?: unknown }).taskSession === "object";
}

async function resolveCachedClient(globalForPrisma: typeof globalThis & {
  prisma?: PrismaClient;
  prismaPromise?: Promise<PrismaClient>;
}) {
  const cachedClient = globalForPrisma.prisma;
  if (hasRequiredDelegates(cachedClient)) {
    return cachedClient;
  }

  if (cachedClient) {
    await cachedClient.$disconnect().catch(() => undefined);
    globalForPrisma.prisma = undefined;
    globalForPrisma.prismaPromise = undefined;
  }

  const cachedPromise = globalForPrisma.prismaPromise;
  if (!cachedPromise) {
    return undefined;
  }

  const promisedClient = await cachedPromise.catch(() => undefined);
  if (hasRequiredDelegates(promisedClient)) {
    return promisedClient;
  }

  if (promisedClient) {
    await promisedClient.$disconnect().catch(() => undefined);
  }

  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaPromise = undefined;
  return undefined;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaPromise?: Promise<PrismaClient>;
};

const prismaPromise = (async () => {
  const cachedClient = await resolveCachedClient(globalForPrisma);
  return cachedClient ?? createDbClient();
})();

export const db = await prismaPromise;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
  globalForPrisma.prismaPromise = Promise.resolve(db);
}

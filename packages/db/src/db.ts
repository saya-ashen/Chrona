import { PrismaClient } from "@/generated/prisma/client";

const DATABASE_URL = process.env.DATABASE_URL || "file:./prisma/dev.db";

if (typeof globalThis.Bun === "undefined") {
  throw new Error(
    "Chrona database runtime requires Bun. " +
    "Please run Chrona through the npm launcher or set CHRONA_BUN_PATH.",
  );
}

async function createAdapter() {
  const { PrismaBunSqlite } = await import("prisma-adapter-bun-sqlite");

  return new PrismaBunSqlite({
    url: DATABASE_URL,
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

import { PrismaClient } from "../packages/db/src/generated/prisma/client";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { ensureSqliteDatabase } from "../packages/db/src/sqlite-migrations";
import { resolveSqliteAdapterUrl } from "../packages/db/src/sqlite-url";
import { resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
ensureSqliteDatabase({
  databaseUrl,
  migrationsDir: process.env.CHRONA_MIGRATIONS_DIR ?? resolve("prisma/migrations"),
});
const prisma = new PrismaClient({
  adapter: new PrismaBunSqlite({ url: resolveSqliteAdapterUrl(databaseUrl) }),
});
try {
  await prisma.workspace.upsert({
    where: { id: "ws_default" },
    update: {},
    create: { id: "ws_default", name: "Personal" },
  });
} finally {
  await prisma.$disconnect();
}

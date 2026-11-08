import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PrismaClient } from "@chrona/db/generated/prisma/client";
import { ensureSqliteDatabase } from "@chrona/db/sqlite-migrations";
import { PrismaBunSqlite } from "prisma-adapter-bun-sqlite";
import { registerTestProvider } from "./test-provider";
export function testDb({ injectedAgent = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "chrona-steward-test-"));
  const databaseUrl = `file:${join(root, "test.db")}`;
  ensureSqliteDatabase({ databaseUrl, migrationsDir: resolve(import.meta.dirname, "../../../../../prisma/migrations") });
  const db = new PrismaClient({ adapter: new PrismaBunSqlite({ url: databaseUrl }) });
  if (injectedAgent) registerTestProvider(db);
  return db;
}

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_DEV_DATABASE_URL = "file:./prisma/dev.db";

export function resolveRuntimeDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  if (env.NODE_ENV === "test") {
    throw new Error("DATABASE_URL must be set explicitly in test runs.");
  }

  return DEFAULT_DEV_DATABASE_URL;
}

export function resolveSqliteAdapterUrl(url: string): string {
  return url;
}

export function isInMemorySqliteUrl(databaseUrl: string): boolean {
  return databaseUrl === "file::memory:" || databaseUrl === ":memory:";
}

export function sqlitePathFromFileUrl(databaseUrl: string): string | null {
  if (isInMemorySqliteUrl(databaseUrl)) {
    return ":memory:";
  }

  if (!databaseUrl.startsWith("file:")) {
    return null;
  }

  const pathWithParams = databaseUrl.slice("file:".length);
  const queryIndex = pathWithParams.indexOf("?");
  return queryIndex >= 0 ? pathWithParams.slice(0, queryIndex) : pathWithParams;
}

export function assertSqliteFileUrl(databaseUrl: string): void {
  if (sqlitePathFromFileUrl(databaseUrl)) {
    return;
  }

  throw new Error(`Chrona requires a SQLite file URL, got: ${databaseUrl}`);
}

export function ensureSqliteParentDir(databaseUrl: string): void {
  const sqlitePath = sqlitePathFromFileUrl(databaseUrl);
  if (!sqlitePath || sqlitePath === ":memory:") {
    return;
  }

  mkdirSync(dirname(resolve(sqlitePath)), { recursive: true });
}

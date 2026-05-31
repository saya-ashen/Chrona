import { mkdirSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

const DEFAULT_DEV_DATABASE_URL = "file:./prisma/dev.db";
const DEFAULT_TEST_DATABASE_URL = "file:./.tmp/bun-test.db";
export const AUTO_TEST_DATABASE_ENV = "CHRONA_AUTO_TEST_DATABASE_URL";

export function resolveRuntimeDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV === "test") {
    const databaseUrl = env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
    assertSafeTestDatabaseUrl(databaseUrl);
    if (!env.DATABASE_URL) {
      env[AUTO_TEST_DATABASE_ENV] = "1";
    }
    env.DATABASE_URL = databaseUrl;
    return databaseUrl;
  }

  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }

  return DEFAULT_DEV_DATABASE_URL;
}

export function isSafeTestDatabaseUrl(databaseUrl: string | undefined, cwd = process.cwd()): boolean {
  const sqlitePath = sqlitePathFromFileUrl(databaseUrl ?? "");
  if (!sqlitePath) {
    return false;
  }

  if (sqlitePath === ":memory:") {
    return true;
  }

  const absolutePath = resolve(cwd, sqlitePath);
  const segments = absolutePath.split(sep).map((segment) => segment.toLowerCase());
  const filename = basename(absolutePath).toLowerCase();

  return segments.includes(".tmp") || filename.includes("test");
}

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined): void {
  if (isSafeTestDatabaseUrl(databaseUrl)) {
    return;
  }

  throw new Error(
    [
      "Refusing to use DATABASE_URL for tests because it does not point to an isolated test SQLite database.",
      `Current DATABASE_URL: ${databaseUrl ?? "(unset)"}`,
      `Use ${DEFAULT_TEST_DATABASE_URL}, an in-memory database, or another path under .tmp / containing test.`,
    ].join(" "),
  );
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

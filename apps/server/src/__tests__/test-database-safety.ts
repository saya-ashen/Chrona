import { basename, resolve, sep } from "node:path";

export function sqlitePathFromDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl?.startsWith("file:")) {
    return undefined;
  }

  const pathWithParams = databaseUrl.slice("file:".length);
  const path = pathWithParams.split("?", 1)[0];
  if (!path) {
    return undefined;
  }

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function isSafeTestDatabaseUrl(databaseUrl: string | undefined, cwd = process.cwd()) {
  const sqlitePath = sqlitePathFromDatabaseUrl(databaseUrl);
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

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined) {
  if (isSafeTestDatabaseUrl(databaseUrl)) {
    return;
  }

  throw new Error(
    [
      "Refusing to reset the database for Bun tests because DATABASE_URL does not point to an isolated test SQLite database.",
      `Current DATABASE_URL: ${databaseUrl ?? "(unset, defaults to file:./prisma/dev.db)"}`,
      "Run `bun run test:bun` or set `DATABASE_URL=file:./.tmp/bun-test.db` before running destructive Bun tests.",
    ].join(" "),
  );
}

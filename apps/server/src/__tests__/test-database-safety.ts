import { isSafeTestDatabaseUrl, sqlitePathFromFileUrl } from "@chrona/db/sqlite-url";

export { isSafeTestDatabaseUrl };

export const sqlitePathFromDatabaseUrl = sqlitePathFromFileUrl;

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined) {
  if (isSafeTestDatabaseUrl(databaseUrl)) {
    return;
  }

  throw new Error(
    [
      "Refusing to reset the database for Bun tests because DATABASE_URL does not point to an isolated test SQLite database.",
      `Current DATABASE_URL: ${databaseUrl ?? "(unset)"}`,
      "Run `bun run test:bun` or set `DATABASE_URL=file:./.tmp/bun-test.db` before running destructive Bun tests.",
    ].join(" "),
  );
}

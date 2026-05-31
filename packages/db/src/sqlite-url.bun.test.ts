import { describe, expect, it } from "bun:test";

import {
  assertSafeTestDatabaseUrl,
  isInMemorySqliteUrl,
  isSafeTestDatabaseUrl,
  resolveRuntimeDatabaseUrl,
  sqlitePathFromFileUrl,
} from "./sqlite-url";

describe("sqlite url helpers", () => {
  it("uses explicit DATABASE_URL first", () => {
    expect(resolveRuntimeDatabaseUrl({ DATABASE_URL: "file:/data/chrona.db", NODE_ENV: "production" })).toBe(
      "file:/data/chrona.db",
    );
  });

  it("keeps development default local", () => {
    expect(resolveRuntimeDatabaseUrl({ NODE_ENV: "development" })).toBe("file:./prisma/dev.db");
  });

  it("defaults tests to an isolated local database", () => {
    const env = { NODE_ENV: "test" } as NodeJS.ProcessEnv;
    expect(resolveRuntimeDatabaseUrl(env)).toBe("file:./.tmp/bun-test.db");
    expect(env.DATABASE_URL).toBe("file:./.tmp/bun-test.db");
    expect(env.CHRONA_AUTO_TEST_DATABASE_URL).toBe("1");
  });

  it("rejects unsafe test database urls", () => {
    expect(() => resolveRuntimeDatabaseUrl({ NODE_ENV: "test", DATABASE_URL: "file:./prisma/dev.db" })).toThrow(
      "does not point to an isolated test SQLite database",
    );
    expect(() => assertSafeTestDatabaseUrl("file:/data/chrona.db")).toThrow(
      "does not point to an isolated test SQLite database",
    );
  });

  it("detects safe test database urls", () => {
    expect(isSafeTestDatabaseUrl(undefined)).toBe(false);
    expect(isSafeTestDatabaseUrl("file:./prisma/dev.db")).toBe(false);
    expect(isSafeTestDatabaseUrl("file:./.tmp/bun-test.db")).toBe(true);
    expect(isSafeTestDatabaseUrl("file:/tmp/chrona-test.db")).toBe(true);
    expect(isSafeTestDatabaseUrl("file::memory:")).toBe(true);
  });

  it("parses sqlite file urls", () => {
    expect(sqlitePathFromFileUrl("file:./.tmp/bun-test.db?connection_limit=1")).toBe("./.tmp/bun-test.db");
    expect(sqlitePathFromFileUrl("file:/data/chrona.db")).toBe("/data/chrona.db");
    expect(sqlitePathFromFileUrl("postgres://localhost/db")).toBeNull();
  });

  it("detects in-memory urls", () => {
    expect(isInMemorySqliteUrl("file::memory:")).toBe(true);
    expect(isInMemorySqliteUrl(":memory:")).toBe(true);
  });
});

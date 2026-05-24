import { describe, expect, it } from "bun:test";

import {
  isInMemorySqliteUrl,
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

  it("requires explicit test database", () => {
    expect(() => resolveRuntimeDatabaseUrl({ NODE_ENV: "test" })).toThrow("DATABASE_URL must be set explicitly");
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

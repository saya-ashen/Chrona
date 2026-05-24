import { describe, expect, it } from "bun:test";
import { isSafeTestDatabaseUrl, sqlitePathFromDatabaseUrl } from "./test-database-safety";

describe("test database safety", () => {
  it("rejects default development and production database URLs", () => {
    expect(isSafeTestDatabaseUrl(undefined)).toBe(false);
    expect(isSafeTestDatabaseUrl("file:./prisma/dev.db")).toBe(false);
    expect(isSafeTestDatabaseUrl("file:./prisma/chrona.db")).toBe(false);
    expect(isSafeTestDatabaseUrl("file:/data/chrona.db")).toBe(false);
  });

  it("accepts isolated test database URLs", () => {
    expect(isSafeTestDatabaseUrl("file:./.tmp/bun-test.db")).toBe(true);
    expect(isSafeTestDatabaseUrl("file:/tmp/chrona-test.db")).toBe(true);
    expect(isSafeTestDatabaseUrl("file::memory:")).toBe(true);
  });

  it("parses sqlite file URLs without query parameters", () => {
    expect(sqlitePathFromDatabaseUrl("file:./.tmp/bun-test.db?connection_limit=1")).toBe(
      "./.tmp/bun-test.db",
    );
  });
});

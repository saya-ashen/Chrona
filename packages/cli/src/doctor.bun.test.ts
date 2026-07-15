import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import { inspectLocalChrona } from "./doctor";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("chrona doctor", () => {
  it("reports a healthy localhost database", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-doctor-"));
    try {
      const databasePath = join(directory, "chrona.db");
      const db = new Database(databasePath);
      db.run('CREATE TABLE "Example" ("id" TEXT PRIMARY KEY)');
      db.close();
      process.env.DATABASE_URL = `file:${databasePath}`;
      process.env.HOST = "127.0.0.1";
      delete process.env.API_KEY;

      expect(inspectLocalChrona()).toEqual([
        expect.objectContaining({ key: "database", status: "ok" }),
        expect.objectContaining({ key: "databaseIntegrity", status: "ok" }),
        expect.objectContaining({ key: "networkBind", status: "ok" }),
        expect.objectContaining({ key: "apiProtection", status: "warning" }),
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("flags an unprotected public bind", () => {
    process.env.DATABASE_URL = `file:${join(tmpdir(), "chrona-doctor-missing.db")}`;
    process.env.HOST = "0.0.0.0";
    delete process.env.API_KEY;

    expect(inspectLocalChrona()).toContainEqual(
      expect.objectContaining({ key: "apiProtection", status: "error" }),
    );
  });
});

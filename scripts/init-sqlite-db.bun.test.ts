import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { acquireSqliteRuntimeLock } from "@chrona/db/sqlite-runtime-lock";

describe("init-sqlite-db", () => {
  it("refuses reset while another Chrona process owns the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "chrona-init-db-lock-"));
    const databasePath = join(directory, "chrona.db");
    const databaseUrl = `file:${databasePath}`;
    const db = new Database(databasePath);
    db.run('CREATE TABLE "Example" ("value" TEXT NOT NULL)');
    db.run('INSERT INTO "Example" ("value") VALUES (?)', ["current"]);
    db.close();
    const lock = acquireSqliteRuntimeLock(databaseUrl);
    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, "scripts/init-sqlite-db.ts", "--reset", databasePath],
        cwd: resolve(import.meta.dir, ".."),
        stderr: "pipe",
        stdout: "pipe",
      });

      expect(result.exitCode).not.toBe(0);
      expect(new TextDecoder().decode(result.stderr)).toContain("already in use");
      expect(existsSync(databasePath)).toBe(true);
      const current = new Database(databasePath, { readonly: true });
      try {
        expect(current.query('SELECT "value" FROM "Example"').get()).toEqual({ value: "current" });
      } finally {
        current.close();
      }
    } finally {
      lock.release();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

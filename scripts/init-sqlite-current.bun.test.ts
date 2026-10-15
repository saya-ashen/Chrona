import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

test("init script initializes idempotently and refuses removed reset flag", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "chrona-init-f1-")), "test.db");
  const script = resolve(import.meta.dirname, "init-sqlite-db.ts");
  for (let i = 0; i < 2; i++) {
    const child = Bun.spawn([process.execPath, script, path], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
  }
  const db = new Database(path);
  try {
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'Workspace'").get()).not.toBeNull();
  } finally { db.close(); }
  const child = Bun.spawn([process.execPath, script, "--reset", path], { stdout: "pipe", stderr: "pipe" });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain("Usage:");
});

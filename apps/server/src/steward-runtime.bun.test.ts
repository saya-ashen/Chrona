import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../../../packages/engine/src/modules/steward/test-db";
import { createStewardRuntime, stewardDataDir } from "./steward-runtime";
test("runtime data directory follows explicit setting then database directory", () => {
  expect(stewardDataDir({ CHRONA_DATA_DIR: "/tmp/chrona-data", DATABASE_URL: "file:/tmp/db/test.db" })).toBe("/tmp/chrona-data");
  expect(stewardDataDir({ DATABASE_URL: "file:/tmp/db/test.db" })).toBe("/tmp/db");
  expect(() => stewardDataDir({ DATABASE_URL: "file::memory:" })).toThrow();
});
test("runtime ticks every 30 seconds, wakes immediately and stops cleanly", async () => {
  const db = testDb();
  let interval = 0, cleared = false;
  const runtime = createStewardRuntime(db, { dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-runtime-")), provider: null, chatTransport: null,
    timers: { setInterval: ((_fn: () => void, ms: number) => { interval = ms; return 1; }) as unknown as typeof setInterval, clearInterval: (() => { cleared = true; }) as typeof clearInterval },
  });
  try {
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    runtime.start(); await runtime.tickOnce();
    expect(interval).toBe(30000);
    expect((await db.stewardState.findUniqueOrThrow({ where: { workspaceId: "w" } })).lastTickAt).not.toBeNull();
    expect((await runtime.health()).provider.available).toBe(false);
    expect((await runtime.health()).jobsSandbox).toBe(false);
    await runtime.stop(); expect(cleared).toBe(true);
  } finally { await runtime.stop(); await db.$disconnect(); }
});

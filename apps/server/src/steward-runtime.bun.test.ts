import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createScriptSandbox } from "../../../packages/integrations/src/steward/script-sandbox";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "@chrona/engine/test-support";
import { createStewardRuntime, stewardDataDir } from "./steward-runtime";
const bwrapPath = Bun.which("bwrap") ?? undefined;
const jobTest = createScriptSandbox({ bwrapPath }).health.available ? test : test.skip;
jobTest("configured runtime job reads affair cwd and wakes only on output change", async () => {
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-job-"));
  let time = new Date("2026-10-15T04:00:00Z");
  const previous = process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  process.env.CHRONA_STEWARD_SANDBOX_BWRAP = bwrapPath;
  const runtime = createStewardRuntime(db, { dataDir, now: () => time, provider: null, chatTransport: null });
  if (previous === undefined) delete process.env.CHRONA_STEWARD_SANDBOX_BWRAP;
  else process.env.CHRONA_STEWARD_SANDBOX_BWRAP = previous;
  try {
    const workspace = await db.workspace.create({ data: { name: "jobs" } });
    const api = runtime.service.forWorkspace(workspace.id), affair = await api.affairs.create({ title: "Check" });
    const directory = await (await api.affairs.files(affair.id)).directory();
    writeFileSync(join(directory, "value.txt"), "first\n");
    await api.schedules.create(affair.id, { mode: "job", rule: { kind: "every", minutes: 5 }, text: "Check file", command: "read -r value < value.txt; printf '%s' \"$value\"" });
    expect((await runtime.health()).jobsSandbox).toBe(true);
    for (let i = 0; i < 2; i++) { time = new Date(time.getTime() + 300000); await api.schedules.fireDue(); }
    expect(await db.run.count()).toBe(1);
    writeFileSync(join(directory, "value.txt"), "changed\n");
    time = new Date(time.getTime() + 300000); await api.schedules.fireDue();
    expect(await db.run.count()).toBe(2);
    expect((await db.run.findMany()).some(run => run.prompt.includes("changed"))).toBe(true);
  } finally { await runtime.stop(); await db.$disconnect(); }
});

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

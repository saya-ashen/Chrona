import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createSettings } from "./settings";
import { createRuns } from "./execution/runs";
import { testDb } from "./__testing__/test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(at = "2026-10-25T16:00:00Z") {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-build-settings-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "build-settings", settings: { custom: "preserve" } } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(at), publicUrl: null };
  const settings = () => createSettings({ ...ports, workspaceId });
  return { db, ports, workspaceId, settings };
}

test("task timeout defaults to unlimited, persists only explicit values, and can be cleared", async () => {
  const f = await fixture();
  expect((await f.settings().get()).runTimeoutMinutes).toBeNull();
  expect((await f.settings().update({ runTimeoutMinutes: 45 })).runTimeoutMinutes).toBe(45);
  expect((await f.settings().update({ timezone: "UTC" })).runTimeoutMinutes).toBe(45);
  expect((await f.settings().update({ runTimeoutMinutes: null })).runTimeoutMinutes).toBeNull();
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).toMatchObject({ custom: "preserve", runTimeoutMinutes: null });
});

test("invalid task timeouts leave persisted settings unchanged", async () => {
  const f = await fixture();
  await f.settings().update({ runTimeoutMinutes: 30 });
  const before = await f.settings().get();
  for (const runTimeoutMinutes of [0, -1, 1.5, 525601, "5"]) {
    await expect(f.settings().update({ runTimeoutMinutes })).rejects.toMatchObject({ code: "invalid" });
    expect(await f.settings().get()).toEqual(before);
  }
});

test("kernel settings reject application authoring policy atomically", async () => {
  const f = await fixture();
  const before = await f.settings().get();
  const stored = (await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings;
  await expect(f.settings().update({ builds: { dailyLimit: 30 } })).rejects.toMatchObject({ code: "invalid" });
  expect(await f.settings().get()).toEqual(before);
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).toEqual(stored);
  expect(await f.db.audit.count({ where: { kind: "settings_updated" } })).toBe(0);
});

for (const lane of ["foreground", "background"] as const) test(`build settings do not impose a timeout on ${lane}`, async () => {
  const f = await fixture();
  await f.db.workspace.update({ where: { id: f.workspaceId }, data: { settings: { builds: { timeoutMinutes: 120 } } } });
  const runs = createRuns(f.ports, f.workspaceId);
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web:other", source: "owner" } });
  await runs.enqueue({ sessionId: session.id, lane, trigger: "message", prompt: "Other work" });
  const run = (await runs.claimNext(lane))!;
  expect(run.deadlineAt).toBeNull();
  expect(run.leaseUntil).toBeNull();
});

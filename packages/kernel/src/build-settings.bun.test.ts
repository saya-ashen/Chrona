import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createBuildGovernance } from "./build-governance";
import { createSettings, kernelSettingsSchema } from "./settings";
import { createRuns } from "./execution/runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(at = "2026-10-25T16:00:00Z") {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-build-settings-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "build-settings", settings: { custom: "preserve" } } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(at), publicUrl: null };
  const settings = () => createSettings({ ...ports, workspaceId });
  const builds = () => createBuildGovernance(ports, workspaceId);
  return { db, ports, workspaceId, settings, builds };
}

test("internal build governance defaults to 20/60/5; partial edits preserve unrelated settings", async () => {
  const f = await fixture(), before = await f.builds().get();
  expect(before.builds).toEqual({ dailyLimit: 20, timeoutMinutes: 60, maxSubmissions: 5 });
  expect(before.buildUsage).toEqual({ date: "2026-10-26", timezone: "Asia/Shanghai", used: 0, remaining: 20 });
  const kernelSettings = await f.settings().get();
  expect(kernelSettingsSchema.safeParse(kernelSettings).success).toBe(true);
  expect(kernelSettings).not.toHaveProperty("builds");
  expect(kernelSettings).not.toHaveProperty("buildUsage");
  const saved = await f.builds().update({ dailyLimit: 30 });
  expect(saved.builds).toEqual({ dailyLimit: 30, timeoutMinutes: 60, maxSubmissions: 5 });
  expect((await f.builds().get()).builds).toEqual(saved.builds);
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).toMatchObject({ custom: "preserve" });
  await f.settings().update({ timezone: "UTC" });
  expect((await f.builds().get()).builds).toEqual(saved.builds);
  await f.builds().update({ timeoutMinutes: 90, maxSubmissions: 2 });
  expect((await f.builds().get()).builds).toEqual({ dailyLimit: 30, timeoutMinutes: 90, maxSubmissions: 2 });
  expect((await f.settings().get()).timezone).toBe("UTC");
  expect(await f.db.audit.findFirst({ where: { kind: "settings_updated" } })).not.toBeNull();
});

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

for (const builds of [
  { dailyLimit: -1 }, { dailyLimit: 201 }, { dailyLimit: 1.5 },
  { timeoutMinutes: 4 }, { timeoutMinutes: 121 }, { timeoutMinutes: "60" },
  { maxSubmissions: 0 }, { maxSubmissions: 21 }, { maxSubmissions: 1.5 },
  { memoryMb: 8192 }, { autoRetry: true },
]) test(`reject invalid build settings ${JSON.stringify(builds)} atomically`, async () => {
  const f = await fixture();
  await expect(f.builds().update(builds)).rejects.toMatchObject({ code: "invalid" });
  expect((await f.settings().get()).timezone).toBe("Asia/Shanghai");
  expect(await f.db.audit.count({ where: { kind: { in: ["settings_updated", "build_settings_updated"] } } })).toBe(0);
});

for (const c of [
  { at: "2026-10-25T15:59:59Z", timezone: "Asia/Shanghai", date: "2026-10-25", used: 1 },
  { at: "2026-10-25T16:00:00Z", timezone: "Asia/Shanghai", date: "2026-10-26", used: 1 },
  { at: "2026-10-25T16:00:00Z", timezone: "UTC", date: "2026-10-25", used: 2 },
]) test(`usage at ${c.at} in ${c.timezone} counts new sessions, not continuations`, async () => {
  const f = await fixture(c.at);
  await f.settings().update({ timezone: c.timezone });
  await f.builds().update({ dailyLimit: 3 });
  for (const [i, at] of ["2026-10-25T15:59:00Z", "2026-10-25T16:00:00Z"].entries()) {
    const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: `build:${i}`, source: "build", status: "ended", createdAt: new Date(at) } });
    // Even failed continuations do not consume another new-session allowance.
    await f.db.run.createMany({ data: [0, 1].map(n => ({ workspaceId: f.workspaceId, sessionId: session.id, lane: "build", trigger: "build", status: "failed", prompt: "", cwd: "/unused", provider: "fake", tokenHash: `${i}-${n}` })) });
  }
  await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web", source: "web", createdAt: f.ports.now() } });
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await f.db.session.create({ data: { workspaceId: other.id, key: "build:other", source: "build", createdAt: f.ports.now() } });
  expect((await f.builds().get()).buildUsage).toEqual({ date: c.date, timezone: c.timezone, used: c.used, remaining: 3 - c.used });
  await f.builds().update({ dailyLimit: 0 });
  expect((await f.builds().get()).buildUsage.remaining).toBe(0);
});

for (const lane of ["foreground", "background"] as const) test(`build settings do not impose a timeout on ${lane}`, async () => {
  const f = await fixture();
  await f.builds().update({ timeoutMinutes: 120 });
  const runs = createRuns(f.ports, f.workspaceId);
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web:other", source: "web" } });
  await runs.enqueue({ sessionId: session.id, lane, trigger: "message", prompt: "Other work" });
  const run = (await runs.claimNext(lane))!;
  expect(run.deadlineAt).toBeNull();
  expect(run.leaseUntil).toBeNull();
});

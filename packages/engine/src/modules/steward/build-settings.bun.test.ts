import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { settingsSchema } from "@chrona/contracts/steward";
import { createSettings } from "./settings";
import { createRuns } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(at = "2026-10-25T16:00:00Z") {
  const db = testDb(), dataDir = await mkdtemp("/tmp/chrona-build-settings-");
  cleanups.push(async () => { await db.$disconnect(); await rm(dataDir, { recursive: true, force: true }); });
  const workspaceId = (await db.workspace.create({ data: { name: "build-settings", settings: { custom: "preserve" } } })).id;
  const ports: StewardPorts = { db, dataDir, now: () => new Date(at), publicUrl: null };
  const settings = () => createSettings({ ...ports, workspaceId }, { status: async () => null, forward: async () => null });
  return { db, ports, workspaceId, settings };
}

test("existing workspaces get 20/60/5; partial owner edits persist without losing unrelated settings", async () => {
  const f = await fixture(), before = await f.settings().get();
  expect(before.builds).toEqual({ dailyLimit: 20, timeoutMinutes: 60, maxSubmissions: 5 });
  expect(settingsSchema.safeParse(before).success).toBe(true);
  const saved = await f.settings().update({ builds: { dailyLimit: 30 } });
  expect(saved.builds).toEqual({ dailyLimit: 30, timeoutMinutes: 60, maxSubmissions: 5 });
  expect((await f.settings().get()).builds).toEqual(saved.builds);
  expect((await f.db.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).settings).toMatchObject({ custom: "preserve" });
  await f.settings().update({ notifications: { timezone: "UTC" } });
  expect((await f.settings().get()).builds).toEqual(saved.builds);
  await f.settings().update({ builds: { timeoutMinutes: 90, maxSubmissions: 2 } });
  expect((await f.settings().get()).builds).toEqual({ dailyLimit: 30, timeoutMinutes: 90, maxSubmissions: 2 });
  expect((await f.settings().get()).notifications.timezone).toBe("UTC");
  expect(await f.db.audit.findFirst({ where: { kind: "settings_updated" } })).not.toBeNull();
});

for (const builds of [
  { dailyLimit: -1 }, { dailyLimit: 201 }, { dailyLimit: 1.5 },
  { timeoutMinutes: 4 }, { timeoutMinutes: 121 }, { timeoutMinutes: "60" },
  { maxSubmissions: 0 }, { maxSubmissions: 21 }, { maxSubmissions: 1.5 },
  { memoryMb: 8192 }, { autoRetry: true },
]) test(`reject invalid build settings ${JSON.stringify(builds)} atomically`, async () => {
  const f = await fixture();
  await expect(f.settings().update({ builds, notifications: { timezone: "UTC" } })).rejects.toMatchObject({ code: "invalid" });
  expect((await f.settings().get()).notifications.timezone).toBe("Asia/Shanghai");
  expect(await f.db.audit.count({ where: { kind: "settings_updated" } })).toBe(0);
});

for (const c of [
  { at: "2026-10-25T15:59:59Z", timezone: "Asia/Shanghai", date: "2026-10-25", used: 1 },
  { at: "2026-10-25T16:00:00Z", timezone: "Asia/Shanghai", date: "2026-10-26", used: 1 },
  { at: "2026-10-25T16:00:00Z", timezone: "UTC", date: "2026-10-25", used: 2 },
]) test(`usage at ${c.at} in ${c.timezone} counts new sessions, not continuations`, async () => {
  const f = await fixture(c.at);
  await f.settings().update({ notifications: { timezone: c.timezone }, builds: { dailyLimit: 3 } });
  for (const [i, at] of ["2026-10-25T15:59:00Z", "2026-10-25T16:00:00Z"].entries()) {
    const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: `build:${i}`, source: "build", status: "ended", createdAt: new Date(at) } });
    // Even failed continuations do not consume another new-session allowance.
    await f.db.run.createMany({ data: [0, 1].map(n => ({ workspaceId: f.workspaceId, sessionId: session.id, lane: "build", trigger: "build", status: "failed", prompt: "", cwd: "/unused", provider: "fake", tokenHash: `${i}-${n}` })) });
  }
  await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web", source: "web", createdAt: f.ports.now() } });
  const other = await f.db.workspace.create({ data: { name: "other" } });
  await f.db.session.create({ data: { workspaceId: other.id, key: "build:other", source: "build", createdAt: f.ports.now() } });
  expect((await f.settings().get()).buildUsage).toEqual({ date: c.date, timezone: c.timezone, used: c.used, remaining: 3 - c.used });
  await f.settings().update({ builds: { dailyLimit: 0 } });
  expect((await f.settings().get()).buildUsage.remaining).toBe(0);
});

test("build claim snapshots owner budgets, leaves running work unchanged and informs the model", async () => {
  const f = await fixture();
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "build:one", source: "build" } });
  await f.db.audit.create({ data: { id: `build-targets:${session.id}`, workspaceId: f.workspaceId, subjectId: session.id, kind: "build_targets", actorKey: "user", details: { name: "sample", modules: ["sample"] } } });
  const runs = createRuns(f.ports, f.workspaceId);
  await runs.enqueue({ sessionId: session.id, lane: "build", trigger: "build", prompt: "Build" });
  await f.settings().update({ builds: { timeoutMinutes: 17, maxSubmissions: 3 } });
  const first = (await runs.claimNext("build"))!;
  expect(first.deadlineAt.getTime() - f.ports.now().getTime()).toBe(17 * 60_000);
  expect(first.leaseUntil).toEqual(first.deadlineAt);
  expect(first.prompt).toContain("at most 3 candidate submissions");
  const snapshot = await f.db.audit.findFirstOrThrow({ where: { kind: "run_claimed", subjectId: first.id } });
  expect(snapshot.details).toMatchObject({ builds: { timeoutMinutes: 17, maxSubmissions: 3 } });
  await f.settings().update({ builds: { timeoutMinutes: 90, maxSubmissions: 7 } });
  expect((await f.db.run.findUniqueOrThrow({ where: { id: first.id } })).deadlineAt).toEqual(first.deadlineAt);
  expect((await f.db.audit.findUniqueOrThrow({ where: { id: snapshot.id } })).details).toEqual(snapshot.details);
  await f.db.run.update({ where: { id: first.id }, data: { status: "finished" } });
  await runs.enqueue({ sessionId: session.id, lane: "build", trigger: "build", prompt: "Continue" });
  const next = (await runs.claimNext("build"))!;
  expect(next.deadlineAt.getTime() - f.ports.now().getTime()).toBe(90 * 60_000);
  expect(next.prompt).toContain("at most 7 candidate submissions");
});

for (const [lane, minutes] of [["foreground", 5], ["background", 20]] as const) test(`build settings do not change ${lane}`, async () => {
  const f = await fixture();
  await f.settings().update({ builds: { timeoutMinutes: 120 } });
  const runs = createRuns(f.ports, f.workspaceId);
  const session = await f.db.session.create({ data: { workspaceId: f.workspaceId, key: "web:other", source: "web" } });
  await runs.enqueue({ sessionId: session.id, lane, trigger: "message", prompt: "Other work" });
  const run = (await runs.claimNext(lane))!;
  expect(run.deadlineAt.getTime() - f.ports.now().getTime()).toBe(minutes * 60_000);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuns, liveRuns, nextLocalMidnight } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notices } from "./test-notices";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string, time: Date;
beforeEach(async () => {
  db = testDb(); time = new Date("2026-10-15T04:00:00Z");
  workspaceId = (await db.workspace.create({ data: { name: "recovery" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:test", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-recovery-")), now: () => time, publicUrl: null };
});
afterEach(async () => { liveRuns.clear(); await db.$disconnect(); });
test("failure retry retains session, prompt and cwd and preserves input linkage", async () => {
  const runs = createRuns(ports, workspaceId);
  const queued = await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Keep this", label: "Visible label" });
  await db.audit.create({ data: { workspaceId, kind: "chat_run_input", actorKey: "user", subjectId: queued.id, details: { messageId: "fixture" } } });
  const run = (await runs.claimNext("foreground"))!;
  await runs.finish(run.id, { outcome: "failed", sessionId: "provider-context", error: "Synthetic" });
  const retry = await db.run.findFirstOrThrow({ where: { status: "queued" } });
  for (const key of ["sessionId", "lane", "trigger", "prompt", "cwd", "label"] as const) expect(retry[key]).toBe(run[key]);
  expect(retry.leaseUntil!.getTime()).toBeGreaterThan(time.getTime());
  expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).providerSessionId).toBe("provider-context");
  expect(await db.audit.findFirst({ where: { subjectId: retry.id, kind: "chat_run_input" } })).not.toBeNull();
});
test.each(["failed", "timed_out", "unavailable"] as const)("build %s preserves work, notifies and never automatically retries", async outcome => {
  const runs = createRuns(ports, workspaceId);
  await db.session.update({ where: { id: sessionId }, data: { source: "build" } });
  await runs.enqueue({ sessionId, lane: "build", trigger: "build", prompt: "Keep this draft" });
  const run = (await runs.claimNext("build"))!;
  await writeFile(join(run.cwd, "draft.txt"), "kept");
  if (outcome === "timed_out") time = new Date(run.deadlineAt.getTime() + 1);
  await runs.finish(run.id, { outcome, sessionId: "provider-context", error: "Synthetic" });
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  expect(await db.audit.count({ where: { kind: "run_continuation", subjectId: run.id } })).toBe(0);
  expect(await readFile(join(run.cwd, "draft.txt"), "utf8")).toBe("kept");
  expect(await notices(db, { title: "模块构建已暂停" })).toMatchObject([{ sessionId, body: expect.stringContaining("不会自动重试") }]);
  await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
});
test("expired lease aborts before finalization and rotates capability", async () => {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  const run = (await runs.claimNext("foreground"))!;
  let aborted = false;
  liveRuns.set(run.id, { done: new Promise(() => {}), inject: async () => {}, abort: async () => { aborted = true; } });
  time = new Date(run.deadlineAt.getTime() + 1);
  expect(await runs.expireLeases()).toBe(1); expect(aborted).toBe(true);
  expect((await db.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("timed_out");
  await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
  expect(await runs.expireLeases()).toBe(0);
});
for (const [zone, at, expected] of [
  ["Asia/Shanghai", "2026-10-15T04:00:00Z", "2026-10-15T16:00:00.000Z"],
  ["America/New_York", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00.000Z"],
]) test(`daily reset respects local midnight and DST: ${zone}`, () => {
  expect(nextLocalMidnight(new Date(at!), zone!).toISOString()).toBe(expected!);
});

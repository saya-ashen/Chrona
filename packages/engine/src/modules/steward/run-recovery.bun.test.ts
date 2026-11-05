import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuns, liveRuns, nextLocalMidnight } from "./runs";
import { testDb } from "./test-db";
import type { StewardPorts } from "./ports";
import { notices } from "./test-notices";
import { providerCancelKey } from "./provider-journal";
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
  for (const key of ["sessionId", "lane", "trigger", "cwd", "label"] as const) expect(retry[key]).toBe(run[key]);
  expect(retry.prompt).toContain("Do not repeat an external action");
  expect(retry.prompt).toEndWith(run.prompt);
  expect(retry.leaseUntil!.getTime()).toBeGreaterThan(time.getTime());
  expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).providerSessionId).toBe("provider-context");
  expect(await db.audit.findFirst({ where: { subjectId: retry.id, kind: "chat_run_input" } })).not.toBeNull();
});
test("ordinary failures stop after three attempts rather than returning after midnight", async () => {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const run = (await runs.claimNext("foreground"))!;
    expect(run).not.toBeNull();
    await runs.finish(run.id, { outcome: "failed", sessionId: "context", error: "Persistent failure" });
    time = new Date(time.getTime() + 3600_000);
  }
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  time = new Date(time.getTime() + 86400_000);
  expect(await runs.claimNext("foreground")).toBeNull();
  expect(await notices(db, { title: "处理已暂停" })).toHaveLength(1);
});
test.each(["unavailable", "unknown"] as const)("%s stops automatic continuation", async kind => {
  const runs = createRuns(ports, workspaceId);
  await runs.enqueue({ sessionId, lane: "foreground", trigger: "message", prompt: "Work" });
  const run = (await runs.claimNext("foreground"))!;
  if (kind === "unknown") await db.moduleInvocation.create({ data: { workspaceId, caller: `provider:${run.id}`, target: "mail", tool: "send", args: {}, key: "send", mode: "sync", status: "unknown" } });
  await runs.finish(run.id, { outcome: kind === "unknown" ? "failed" : "unavailable", sessionId: null, error: "Interrupted" });
  expect(await db.run.count({ where: { status: "queued" } })).toBe(0);
  expect(await notices(db, { title: "处理已暂停" })).toHaveLength(1);
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
  const paused = await notices(db, { title: "模块构建已暂停" });
  expect(paused[0]!.body).toEndWith("未启用：本次构建未提交版本");
  expect(paused).toMatchObject([{ sessionId, body: expect.stringContaining("不会自动重试") }]);
  await expect(runs.authenticate(run.token)).rejects.toMatchObject({ code: "forbidden" });
});
test.each(["failed", "cancelled"] as const)("a build that ends %s tells the conversation that asked for it", async outcome => {
  const runs = createRuns(ports, workspaceId);
  const build = await db.session.create({ data: { workspaceId, key: "build:images", source: "build", title: "构建模块 image-generation", originSessionId: sessionId } });
  await runs.enqueue({ sessionId: build.id, lane: "build", trigger: "build", prompt: "Build it" });
  const run = (await runs.claimNext("build"))!;
  if (outcome === "cancelled") await db.audit.create({ data: { id: providerCancelKey(run.id), workspaceId, kind: "provider_cancel", actorKey: "user", subjectId: run.id, details: {} } });
  await runs.finish(run.id, { outcome: "failed", sessionId: "provider-context", error: "Connection error." });
  const [told] = await db.message.findMany({ where: { sessionId, direction: "out" } });
  expect(told!.text).toContain("构建「构建模块 image-generation」结束：");
  expect(told!.text).toContain(outcome === "cancelled" ? "已被取消" : "未完成（Connection error.）");
  expect(told!.text).toEndWith("未启用：本次构建未提交版本");
  // The build is not retried; the conversation that asked for it runs once more with the result.
  expect(await db.run.findMany({ where: { status: "queued" }, select: { sessionId: true, lane: true, trigger: true } })).toEqual([{ sessionId, lane: "foreground", trigger: "build" }]);
});
test("a finished build wakes its conversation with the result, at most five times before the user speaks again", async () => {
  const runs = createRuns(ports, workspaceId);
  const finishBuild = async (n: number) => {
    const build = await db.session.create({ data: { workspaceId, key: `build:b${n}`, source: "build", title: `构建模块 m${n}`, originSessionId: sessionId } });
    await runs.enqueue({ sessionId: build.id, lane: "build", trigger: "build", prompt: "Build it" });
    const run = (await runs.claimNext("build"))!;
    const reply = await db.message.create({ data: { workspaceId, sessionId: build.id, channel: "in_app", direction: "out", text: `m${n} 已提交审批`, at: time } });
    await db.audit.create({ data: { workspaceId, kind: "run_reply", actorKey: "chrona", subjectId: run.id, details: { messageId: reply.id } } });
    await runs.finish(run.id, { outcome: "finished", sessionId: "provider-context", error: null });
    // The woken turn runs and ends, as the conversation would.
    const woken = await db.run.findFirst({ where: { sessionId, status: "queued" } });
    if (woken) await db.run.update({ where: { id: woken.id }, data: { status: "finished" } });
    return woken;
  };
  await db.message.create({ data: { workspaceId, sessionId, channel: "in_app", direction: "in", text: "依次构建", at: time } });
  time = new Date(time.getTime() + 1000);
  const first = await finishBuild(1);
  expect(first).toMatchObject({ lane: "foreground", trigger: "build", label: "构建结束：构建模块 m1" });
  expect(first!.prompt).toContain("m1 已提交审批");
  expect((await db.message.findMany({ where: { sessionId, direction: "out" } })).map(m => m.text)).toEqual(["m1 已提交审批\n\n未启用：本次构建未提交版本"]);
  for (let n = 2; n <= 5; n++) expect(await finishBuild(n)).not.toBeNull();
  expect(await finishBuild(6)).toBeNull();
  time = new Date(time.getTime() + 1000);
  await db.message.create({ data: { workspaceId, sessionId, channel: "in_app", direction: "in", text: "继续", at: time } });
  time = new Date(time.getTime() + 1000);
  expect(await finishBuild(7)).not.toBeNull();
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

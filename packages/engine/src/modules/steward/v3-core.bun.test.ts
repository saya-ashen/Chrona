import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { todayViewSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createSchedules } from "./schedules";
import { createRuns } from "./runs";
import { createTools } from "./tools";
import { createToday } from "./today";
import type { StewardPorts } from "./ports";
import { notice } from "./test-notices";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "core" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:origin", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-core-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null };
});
afterEach(async () => { await db.$disconnect(); });
test("wake creates a fresh session per firing and final reply returns to origin through notification budget", async () => {
  await db.message.create({ data: { workspaceId, sessionId, direction: "in", channel: "in_app", text: "Origin" } });
  const schedules = createSchedules(ports, workspaceId), runs = createRuns(ports, workspaceId);
  await schedules.create(sessionId, { mode: "wake", rule: { kind: "at", at: ports.now().toISOString() }, text: "Self-contained instruction", label: "Visible work" });
  expect(await schedules.fireDue()).toBe(1); expect(await schedules.fireDue()).toBe(0);
  const run = (await runs.claimNext("background"))!;
  expect(run.sessionId).not.toBe(sessionId);
  expect(run.session?.source).toBe("wake"); expect(run.session?.originSessionId).toBe(sessionId);
  expect(run.session?.providerSessionId).toBeNull();
  await createTools(ports).call(run.token, "chrona_reply", { text: "Completed work" });
  expect(await db.message.count({ where: { sessionId, direction: "out" } })).toBe(0);
  await runs.finish(run.id, { outcome: "finished", sessionId: "new-context", error: null });
  await runs.finish(run.id, { outcome: "finished", sessionId: "new-context", error: null });
  expect(await db.message.count({ where: { sessionId, direction: "out", text: "Completed work" } })).toBe(1);
  const notification = await notice(db, { idempotencyKey: `session-result:${run.id}` });
  expect(notification.sessionId).toBe(sessionId); expect(notification.body).toBe("Completed work");
});
test.each([
  ["finished", false, "ended"],
  ["finished", true, "active"],
  ["failed", false, "active"],
] as const)("a wake conversation %s (open approval=%p) ends only when nothing waits on it: %s", async (outcome, approval, expected) => {
  const schedules = createSchedules(ports, workspaceId), runs = createRuns(ports, workspaceId);
  await schedules.create(sessionId, { mode: "wake", rule: { kind: "at", at: ports.now().toISOString() }, text: "Self-contained instruction", label: "Visible work" });
  await schedules.fireDue();
  const run = (await runs.claimNext("background"))!;
  if (approval) await db.approval.create({ data: { workspaceId, action: "mount_path", title: "mount", detail: "mount", preview: "mount", payload: { sessionId: run.sessionId, lane: "background" } } });
  await runs.finish(run.id, { outcome, sessionId: null, error: outcome === "failed" ? "boom" : null });
  expect((await db.session.findUniqueOrThrow({ where: { id: run.sessionId! } })).status).toBe(expected);
});
test.each([
  ["build", 8, false, "ended"],
  ["build", 1, false, "active"],
  ["build", 8, true, "active"],
  ["mcp", 2, false, "ended"],
  ["mcp", 0.5, false, "active"],
  ["mcp", 2, true, "active"],
] as const)("a %s conversation idle %d days (queued run=%p) is %s", async (source, days, queued, expected) => {
  const build = await db.session.create({ data: { workspaceId, key: `${source}:${days}:${queued}`, source, originSessionId: source === "build" ? sessionId : null, lastActivityAt: new Date(ports.now().getTime() - days * 86_400_000) } });
  if (queued) await createRuns(ports, workspaceId).enqueue({ sessionId: build.id, lane: source === "build" ? "build" : "foreground", trigger: source === "build" ? "build" : "message", label: source, prompt: "p" });
  await createRuns(ports, workspaceId).endIdleBuilds();
  expect((await db.session.findUniqueOrThrow({ where: { id: build.id } })).status).toBe(expected);
});
test("schedules validate origin workspace and list by origin", async () => {
  const schedules = createSchedules(ports, workspaceId), input = { mode: "wake", rule: { kind: "every", minutes: 60 }, text: "Future work" };
  await expect(schedules.create(undefined, input)).rejects.toMatchObject({ code: "invalid" });
  await expect(schedules.create("missing", input)).rejects.toMatchObject({ code: "not_found" });
  const schedule = await schedules.create(sessionId, input);
  expect((await schedules.list(sessionId)).map(item => item.id)).toEqual([schedule.id]);
  await schedules.cancel(schedule.id);
  expect(await schedules.fireDue()).toBe(0);
});
test("today projects sessions and agenda without leaking wake instructions", async () => {
  await createSchedules(ports, workspaceId).create(sessionId, { mode: "wake", rule: { kind: "every", minutes: 60 }, text: "PRIVATE INSTRUCTION", label: "User label" });
  const today = createToday({ db, workspaceId, now: ports.now }, { provider: async () => ({ name: "fixture", available: true, sandboxed: true, lastError: null }), moduleSandbox: () => false,
    notifications: { list: async () => [], status: async () => null } });
  const result = todayViewSchema.parse(await today.get());
  expect(result.sessions[0]?.id).toBe(sessionId); expect(result.upcoming[0]?.label).toBe("User label");
  expect(JSON.stringify(result)).not.toContain("PRIVATE INSTRUCTION");
});

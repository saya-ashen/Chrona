import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NOTIFICATION_SETTINGS, todayViewSchema } from "@chrona/contracts/steward";
import { testDb } from "./test-db";
import { createSchedules } from "./schedules";
import { createRuns } from "./runs";
import { createTools } from "./tools";
import { createToday } from "./today";
import { enqueueNotification } from "./notify";
import type { StewardPorts } from "./ports";
let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string;
beforeEach(async () => {
  db = testDb(); workspaceId = (await db.workspace.create({ data: { name: "core" } })).id;
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:origin", source: "web" } })).id;
  ports = { db, dataDir: await mkdtemp(join(tmpdir(), "chrona-core-")), now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null, chat: null, deliveries: [] };
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
  const notification = await db.notification.findFirstOrThrow({ where: { idempotencyKey: `session-result:${run.id}` } });
  expect(notification.sessionId).toBe(sessionId); expect(notification.body).toBe("Completed work");
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
  const today = createToday({ db, workspaceId, now: ports.now }, { provider: async () => ({ name: "fixture", available: true, sandboxed: true, lastError: null }), moduleSandbox: () => false });
  const result = todayViewSchema.parse(await today.get());
  expect(result.sessions[0]?.id).toBe(sessionId); expect(result.upcoming[0]?.label).toBe("User label");
  expect(JSON.stringify(result)).not.toContain("PRIVATE INSTRUCTION");
});
test("response-keyed notifications bypass the proactive cap", async () => {
  await db.workspace.update({ where: { id: workspaceId }, data: { settings: { notifications: { ...DEFAULT_NOTIFICATION_SETTINGS, dailyCap: 0 } } } });
  const context = { now: ports.now(), chatBound: true, publicUrl: null };
  const proactive = await enqueueNotification(db, { workspaceId, level: "now", title: "t", body: "b", dedupeKey: "qq-final:1" }, context);
  const response = await enqueueNotification(db, { workspaceId, level: "now", title: "t", body: "b", dedupeKey: "response:qq-final:2" }, context);
  expect([proactive.status, response.status]).toEqual(["folded", "queued"]);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { testDb } from "./test-db";
import { createSchedules, migrateLegacyWakeTimers } from "./schedules";
import webManifest from "./builtin/web/module.json";
import type { StewardPorts } from "./ports";

let db: ReturnType<typeof testDb>, ports: StewardPorts, workspaceId: string, sessionId: string, owner: { moduleId: string; hash: string };
beforeEach(async () => {
  db = testDb();
  workspaceId = (await db.workspace.create({ data: { name: "wake-migration" } })).id;
  const module = await db.module.create({ data: { workspaceId, name: "web", activeHash: "checked-entry" } });
  owner = { moduleId: module.id, hash: "checked-entry" };
  await db.moduleVersion.create({ data: { moduleId: module.id, hash: owner.hash, status: "approved", source: "user", intent: {}, report: {}, manifest: webManifest } });
  sessionId = (await db.session.create({ data: { workspaceId, key: "web:origin", source: "web", entryModuleId: module.id } })).id;
  ports = { db, dataDir: "/unused-wake-migration", now: () => new Date("2026-10-15T04:00:00Z"), publicUrl: null };
});
afterEach(async () => { await db.$disconnect(); });
const migrate = (limit = 20) => migrateLegacyWakeTimers(ports, workspaceId, { stopped: true, limit, owners: [owner] });
function wake(extra: Record<string, unknown> = {}) {
  return db.schedule.create({ data: { workspaceId, originSessionId: sessionId, mode: "wake", rule: { kind: "every", minutes: 60 }, text: "Continue my work", label: "Visible timer", nextAt: ports.now(), until: new Date("2026-11-01Z"), createdBy: "user", ...extra } });
}
test("explicit offline migration preserves timer intent and queues an entry-owned event, not a kernel wake session", async () => {
  const timer = await wake(), sessions = await db.session.count();
  expect(await migrate()).toEqual({ migrated: [{ scheduleId: timer.id, ...owner }] });
  expect(await migrate()).toEqual({ migrated: [] });
  expect(await db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({
    mode: "module", moduleId: owner.moduleId, rule: timer.rule, nextAt: timer.nextAt, until: timer.until, label: timer.label, status: "active", originSessionId: sessionId,
    text: `legacy-wake:${timer.id}`, payload: { kind: "legacy-wake", originSessionId: sessionId, text: timer.text },
  });
  expect(await createSchedules(ports, workspaceId).fireDue(ports.now(), { waitForDelivery: false })).toBe(1);
  const invocation = await db.moduleInvocation.findFirstOrThrow({ where: { workspaceId } });
  expect(invocation).toMatchObject({ target: "web", mode: "schedule", status: "queued", args: { scheduleId: timer.id, moduleId: owner.moduleId, hash: owner.hash, payload: { kind: "legacy-wake", text: timer.text } } });
  expect(await db.session.count()).toBe(sessions);
  expect(await db.run.count()).toBe(0);
});
test("unmigrated due wakes fail visibly without consuming work or creating sessions", async () => {
  const timer = await wake();
  await expect(createSchedules(ports, workspaceId).fireDue()).rejects.toMatchObject({ code: "conflict" });
  expect(await db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ mode: "wake", nextAt: timer.nextAt });
  expect(await db.run.count()).toBe(0);
});
test("migration follows persisted nested origins and preserves paused timers", async () => {
  const nested = await db.session.create({ data: { workspaceId, key: "wake:nested", source: "wake", originSessionId: sessionId } });
  const timer = await wake({ originSessionId: nested.id, status: "paused", nextAt: null });
  await db.module.update({ where: { id: owner.moduleId }, data: { status: "paused" } });
  await migrate();
  expect(await db.schedule.findUniqueOrThrow({ where: { id: timer.id } })).toMatchObject({ mode: "module", moduleId: owner.moduleId, status: "paused", nextAt: null, originSessionId: nested.id });
});
test.each(["unresolved", "foreign", "pin", "unapproved", "nonentry", "paused-owner", "oversized", "origin-cycle"])("migration rejects %s without partial conversion", async reason => {
  await wake({ id: "a-valid" });
  const timer = await wake({ id: "z-invalid" });
  if (reason === "unresolved") await db.schedule.update({ where: { id: timer.id }, data: { originSessionId: null } });
  if (reason === "foreign") {
    const foreign = await db.workspace.create({ data: { name: "foreign" } });
    const origin = await db.session.create({ data: { workspaceId: foreign.id, key: "web:foreign", source: "web", entryModuleId: owner.moduleId } });
    await db.schedule.update({ where: { id: timer.id }, data: { originSessionId: origin.id } });
  }
  if (reason === "pin") owner.hash = "wrong-version";
  if (reason === "unapproved") await db.moduleVersion.updateMany({ where: { moduleId: owner.moduleId }, data: { status: "testing" } });
  if (reason === "nonentry") await db.moduleVersion.updateMany({ where: { moduleId: owner.moduleId }, data: { manifest: { name: "web", entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: [], tests: ["test.ts"] } } });
  if (reason === "paused-owner") await db.module.update({ where: { id: owner.moduleId }, data: { status: "paused" } });
  if (reason === "oversized") await db.schedule.update({ where: { id: timer.id }, data: { text: "x".repeat(4000) } });
  if (reason === "origin-cycle") {
    const origin = await db.session.create({ data: { workspaceId, key: "wake:cycle", source: "wake" } });
    await db.session.update({ where: { id: origin.id }, data: { originSessionId: origin.id } });
    await db.schedule.update({ where: { id: timer.id }, data: { originSessionId: origin.id } });
  }
  await expect(migrate()).rejects.toMatchObject({ code: "conflict" });
  expect(await db.schedule.count({ where: { mode: "wake" } })).toBe(2);
  expect(await db.audit.count({ where: { kind: "wake_timer_migrated" } })).toBe(0);
});
test("explicit batch limit refuses all work, while existing app timers remain unchanged", async () => {
  await wake(); await wake();
  const timers = createSchedules(ports, workspaceId).forModule(owner.moduleId, "web");
  const current = await timers.create({ key: "current", label: "Current timer", rule: { kind: "every", minutes: 60 }, payload: { current: true } });
  await expect(migrate(1)).rejects.toMatchObject({ code: "conflict" });
  expect(await db.schedule.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ payload: { current: true }, mode: "module" });
  expect(await db.schedule.count({ where: { mode: "wake" } })).toBe(2);
});
test.each(["queued-run", "unknown-stop", "unknown-delivery"])("migration refuses outstanding %s", async kind => {
  await wake();
  if (kind === "unknown-delivery") await db.moduleInvocation.create({ data: { workspaceId, caller: "system:schedules", target: "web", tool: "schedule", mode: "schedule", key: "unknown", args: {}, status: "unknown" } });
  else await db.run.create({ data: { workspaceId, sessionId, lane: "background", trigger: "schedule", provider: "fixture", tokenHash: kind, cwd: "/unused", prompt: "", status: kind === "queued-run" ? "queued" : "failed", error: kind === "unknown-stop" ? "Execution stop is unconfirmed" : null } });
  await expect(migrate()).rejects.toMatchObject({ code: "conflict" });
  expect(await db.schedule.count({ where: { mode: "wake" } })).toBe(1);
});

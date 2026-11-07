import { expect, test } from "bun:test";
import { todayViewSchema } from "@chrona/contracts/steward";
import { todayView } from "./builtin/web/today";
import { testDb } from "./test-db";
import { entryConversations, createSessions } from "./sessions";
import { memory } from "./memory";
import { startOwnerBuildAsCaller } from "./owner-build";
import type { StewardPorts } from "./ports";

const at = "2026-10-27T04:00:00Z";
const runtime = { at, provider: { name: "fixture", available: true, sandboxed: false, lastError: null }, moduleSandbox: false,
  queuedRuns: 0, runningRuns: 0, failedRunsToday: 0, dueSchedules: 0, lastTickAt: null };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const answers: Record<string, unknown> = { "chat.runtime": runtime, "approvals.list": [], "schedules.list": [], "notify.list": { items: [] },
    "notify.status": { queued: 2, failed: 1 }, "chat.sessions": [], "modules.list": [], "modules.health": { items: [], nextCursor: null }, ...overrides };
  return { calls, call: async (target: string, args?: Record<string, unknown>) => { calls.push([target, args]); const result = answers[target]; if (result instanceof Error) throw result; return result; } };
}
test("web owns overview filtering, ordering and horizon, retaining runtime health and hiding wake instructions", async () => {
  const schedule = { status: "active", mode: "wake", text: "PRIVATE INSTRUCTION", until: null, label: "User label", nextAt: "2026-10-27T05:00:00Z" };
  const f = fixture({ "schedules.list": [
    { ...schedule, id: "far", nextAt: "2026-11-10T05:00:00Z" }, { ...schedule, id: "paused", status: "paused" },
    { ...schedule, id: "past", nextAt: "2026-10-26T05:00:00Z" }, { ...schedule, id: "expired", until: "2026-10-27T04:30:00Z" },
    { ...schedule, id: "later", nextAt: "2026-10-27T06:00:00Z" }, { ...schedule, id: "first" },
    { ...schedule, id: "unnamed", label: null, nextAt: "2026-10-27T07:00:00Z" },
  ] });
  const result = todayViewSchema.parse(await todayView(f.call));
  expect(result.upcoming.map(item => item.scheduleId)).toEqual(["first", "later", "unnamed"]);
  expect(result.upcoming[0]!.label).toBe("User label");
  expect(result.upcoming[2]!.label).toBeNull();
  expect(JSON.stringify(result)).not.toContain("PRIVATE INSTRUCTION");
  expect(result.health).toMatchObject({ queuedNotifications: 2, failedNotifications: 1 });
  expect(f.calls).toContainEqual(["schedules.list", { timers: true }]);
  expect(f.calls).toContainEqual(["chat.sessions", { entries: true, limit: 20 }]);
  expect(f.calls.some(([target]) => target === "chat.today")).toBe(false);
});
test("web follows health cursors, excludes recovered facts and bounds problems", async () => {
  const f = fixture();
  const call = async (target: string, args?: Record<string, unknown>) => target === "modules.health" ? {
    items: [{ module: args?.cursor ? "second" : "first", moduleId: args?.cursor ? "m2" : "m1", open: true, incident: { status: "unresolved", lastAt: args?.cursor ? "2026-10-27T05:00:00Z" : at }, contractFailureCount: 0, nextAction: "检查" },
      { module: "recovered", moduleId: "m3", open: false, incident: null, contractFailureCount: 0, nextAction: null }],
    nextCursor: args?.cursor ? null : "next",
  } : f.call(target, args);
  expect((await todayView(call)).problems.map(item => item.module)).toEqual(["second", "first"]);
});
test("optional module health failures keep the page available; required reads fail visibly", async () => {
  const optionalFailure = await todayView(fixture({ "modules.health": new Error("unavailable"), "notify.status": new Error("unavailable"), "notify.list": new Error("unavailable") }).call);
  expect(optionalFailure.problems).toEqual([]);
  expect(optionalFailure.updates).toEqual([]);
  await expect(todayView(fixture({ "approvals.list": new Error("unavailable") }).call)).rejects.toThrow("unavailable");
});
test("conversation reads recognize entry manifests and bound entry sessions without application-name lists", async () => {
  const db = testDb(), workspaceId = (await db.workspace.create({ data: { name: "entries" } })).id;
  const ports: StewardPorts = { db, dataDir: "/unused", now: () => new Date(at), publicUrl: null };
  const included: string[] = [];
  try {
    for (const [name, uses, entry] of [["new-entry", ["chat.send", "memory.status"], true], ["agent-entry", ["*"], true],
      ["approval-entry", ["approvals.resolve", "memory.status"], true], ["web", ["approvals.request", "memory.status"], false]] as const) {
      const module = await db.module.create({ data: { workspaceId, name, activeHash: "h" } });
      await db.moduleVersion.create({ data: { moduleId: module.id, hash: "h", manifest: { name, entry: "index.ts", keepAlive: true, triggers: [], effects: [], uses: [...uses], tests: ["test.ts"] }, status: "approved", source: "builtin", intent: {}, report: {} } });
      const session = await db.session.create({ data: { workspaceId, key: `${name}:test`, source: "web", entryModuleId: module.id } });
      if (entry) included.push(session.id);
      const caller = { kind: "module" as const, module: name, moduleId: module.id, hash: "h" };
      const result = memory.handle({ ports, workspaceId, caller }, "status", {});
      if (entry) expect(await result).toMatchObject({ available: false });
      else await expect(result).rejects.toMatchObject({ code: "forbidden" });
      await expect(startOwnerBuildAsCaller(ports, workspaceId, caller, {})).rejects.toMatchObject(entry ? { name: "ZodError" } : { code: "forbidden" });
    }
    await db.session.create({ data: { workspaceId, key: "build", source: "build" } });
    expect((await db.session.findMany({ where: { workspaceId, ...await entryConversations(db, workspaceId) } })).map(row => row.id).sort()).toEqual(included.sort());
    expect((await createSessions(ports, workspaceId).list({ entries: true })).map(row => row.id).sort()).toEqual(included.sort());
    expect(await createSessions(ports, workspaceId).list({ entries: true, limit: 1 })).toHaveLength(1);
  } finally { await db.$disconnect(); }
});

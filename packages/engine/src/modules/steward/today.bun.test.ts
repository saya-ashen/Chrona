import { expect, test } from "bun:test";
import { todayView } from "./external/web/today";

const at = "2026-10-27T04:00:00Z";
const runtime = { at, provider: { name: "fixture", available: true, sandboxed: false, lastError: null }, moduleSandbox: false,
  queuedRuns: 0, runningRuns: 0, failedRunsToday: 0, dueSchedules: 0, lastTickAt: null };
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const answers: Record<string, unknown> = { "activity.runtime": runtime, "approvals.list": { items: [], nextCursor: null }, "notify.list": { items: [] },
    "notify.counts": { queued: 2, failed: 1 }, "modules.list": { items: [], nextCursor: null }, ...overrides };
  return { calls, call: async (target: string, args?: Record<string, unknown>) => { calls.push([target, args]); const result = answers[target]; if (result instanceof Error) throw result; return result; } };
}
test("web retains runtime health with empty upcoming and no calendar source", async () => {
  const f = fixture({ "schedules.list": new Error("PRIVATE INSTRUCTION: no calendar source") });
  const result = await todayView(f.call, async () => []);
  expect(result).toMatchObject({ generatedAt: at, approvals: [], updates: [], apps: [], problems: [], sessions: [] });
  expect(result.upcoming).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE INSTRUCTION");
  expect(result.health).toMatchObject({ queuedNotifications: 2, failedNotifications: 1 });
  expect(f.calls.map(([target]) => target).sort()).toEqual([
    "activity.runtime", "approvals.list", "modules.list", "notify.counts", "notify.list",
  ]);
  expect(f.calls).toContainEqual(["notify.list", { limit: 20 }]);
});
test("web projects Notify-owned updates while preserving delivery and source details", async () => {
  const update = { id: "private-notice", moduleId: "source-module", sessionId: "private-session", level: "now", channel: "third-party-room",
    status: "failed", title: "Update", body: "**Details**", format: "markdown", link: "/sessions/private-session", attempts: 3,
    lastError: "Delivery rejected", createdAt: at, sentAt: null, feedback: null };
  const f = fixture({ "notify.list": { items: [update] } });
  const result = await todayView(f.call, async () => []);
  const { format: _format, ...expected } = update;
  expect(result.updates).toEqual([expected]);
  expect(result.updates[0]).not.toHaveProperty("format");
});
test("web uses listed health summaries and excludes closed recovered facts", async () => {
  const health = (module: string, open: boolean, lastAt: string) => ({ module, moduleId: module, open,
    incident: { status: open ? "unresolved" : "recovered", lastAt }, contractFailureCount: 0, nextAction: open ? "检查" : null, truncated: false });
  const f = fixture({ "modules.list": { items: [
    { id: "first", name: "first", health: health("first", true, at) },
    { id: "second", name: "second", health: health("second", true, "2026-10-27T05:00:00Z") },
    { id: "recovered", name: "recovered", health: health("recovered", false, "2026-10-27T06:00:00Z") },
  ], nextCursor: null } });
  expect((await todayView(f.call, async () => [])).problems.map(item => item.module)).toEqual(["second", "first"]);
  expect(f.calls.filter(([target]) => target.startsWith("modules."))).toEqual([["modules.list", {}]]);
});
test.each(["not_found", "unavailable"])("optional Notify %s errors keep Today available", async code => {
  const failure = Object.assign(new Error(`Notify ${code}`), { code });
  for (const target of ["notify.list", "notify.counts"]) {
    const result = await todayView(fixture({ [target]: failure }).call, async () => []);
    expect(result.upcoming).toEqual([]);
    expect(result.problems).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.health).toMatchObject(target === "notify.counts"
      ? { queuedNotifications: 0, failedNotifications: 0 }
      : { queuedNotifications: 2, failedNotifications: 1 });
  }
});
test("Today preserves unexpected Notify errors and all required read errors", async () => {
  for (const target of ["notify.list", "notify.counts"]) {
    for (const code of [undefined, "invalid", "forbidden", "conflict"]) {
      const failure = Object.assign(new Error(`${target} failed`), code ? { code } : {});
      await expect(todayView(fixture({ [target]: failure }).call, async () => [])).rejects.toBe(failure);
    }
  }
  for (const target of ["activity.runtime", "approvals.list", "modules.list"]) {
    for (const code of [undefined, "not_found", "unavailable"]) {
      const failure = Object.assign(new Error(`${target} failed`), code ? { code } : {});
      await expect(todayView(fixture({ [target]: failure }).call, async () => [])).rejects.toBe(failure);
    }
  }
});
test("web bounds private conversations and propagates private journal failures", async () => {
  const f = fixture(), sessions = Array.from({ length: 25 }, (_, id) => ({ id: `private-${id}`, title: `Conversation ${id}` }));
  expect((await todayView(f.call, async () => sessions)).sessions).toEqual(sessions.slice(0, 20));
  expect(f.calls.some(([target]) => target.startsWith("history."))).toBe(false);
  await expect(todayView(f.call, async () => { throw new Error("journal unavailable"); })).rejects.toThrow("journal unavailable");
});

test("Today content does not wait for runtime probing or fetch unused health counters", async () => {
  const f = fixture({ "activity.runtime": new Error("runtime must be read independently"), "notify.counts": new Error("unused counter") });
  const result = await todayView(f.call, async () => [], false);
  expect(result).toMatchObject({ approvals: [], updates: [], apps: [], sessions: [] });
  expect(result).not.toHaveProperty("health");
  expect(f.calls.some(([target]) => target === "activity.runtime" || target === "notify.counts")).toBe(false);
});

import { expect, test } from "bun:test";
import { todayView } from "./today";

type Args = Record<string, unknown>;
function fixture(failure?: { target: string; code: string }) {
  const calls: [string, Args | undefined][] = [];
  const call = async (target: string, args?: Args): Promise<unknown> => {
    calls.push([target, args]);
    if (target === failure?.target) throw Object.assign(new Error("read failed"), { code: failure.code });
    switch (target) {
      case "activity.runtime": return { at: "2026-11-08T00:00:00Z", queuedRuns: 2 };
      case "approvals.list": return { items: [{ id: "approval" }], nextCursor: null };
      case "notify.list": return { items: [{ id: "notice", format: "private", body: "提醒" }] };
      case "notify.counts": return { queued: 3, failed: 1 };
      case "modules.list": return { items: [{ id: "app", name: "example", status: "active",
        health: { module: "example", moduleId: "app", open: true, incident: { status: "unresolved", lastAt: "2026-11-07" }, contractFailureCount: 2, nextAction: "检查应用", truncated: false } }], nextCursor: null };
      default: throw new Error(`Unexpected ${target}`);
    }
  };
  return { call, calls };
}

test("Today composes app facts and foreground sessions without a schedule API or horizon", async () => {
  const f = fixture(), sessions = Array.from({ length: 25 }, (_, id) => ({ id }));
  const view = await todayView(f.call, async () => sessions);
  expect(view).toMatchObject({ generatedAt: "2026-11-08T00:00:00Z", upcoming: [], approvals: [{ id: "approval" }], updates: [{ id: "notice", body: "提醒" }],
    problems: [{ module: "example", incidentStatus: "unresolved", contractFailures: 2 }], health: { queuedRuns: 2, queuedNotifications: 3, failedNotifications: 1 } });
  expect(view.updates[0]).not.toHaveProperty("format");
  expect(view.sessions).toEqual(sessions.slice(0, 20));
  expect(f.calls.filter(([target]) => target === "modules.list")).toEqual([["modules.list", undefined]]);
  expect(f.calls.some(([target]) => target === "modules.health")).toBe(false);
  expect(f.calls.some(([target]) => target.startsWith("schedules.") || target.startsWith("modules.build-"))).toBe(false);
});

for (const target of ["notify.list", "notify.counts"]) {
  test.each(["not_found", "unavailable"])(`Today tolerates optional ${target} %s`, async code => {
    const view = await todayView(fixture({ target, code }).call, async () => []);
    if (target === "notify.list") expect(view.updates).toEqual([]);
    else expect(view.health).toMatchObject({ queuedNotifications: 0, failedNotifications: 0 });
  });
  test.each(["forbidden", "failed", "invalid"])(`Today exposes unexpected ${target} %s`, async code => {
    await expect(todayView(fixture({ target, code }).call, async () => [])).rejects.toMatchObject({ code });
  });
}
test("Today exposes app health and foreground conversation read failures", async () => {
  await expect(todayView(fixture({ target: "modules.list", code: "unavailable" }).call, async () => [])).rejects.toMatchObject({ code: "unavailable" });
  await expect(todayView(fixture().call, async () => { throw new Error("journal failed"); })).rejects.toThrow("journal failed");
});

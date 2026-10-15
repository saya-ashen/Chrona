import { describe, expect, it } from "vitest";
import type { Affair } from "@chrona/contracts";
import { affairFixture, detailFixture, questionFixture } from "./fixtures";
import { affairState, detailView, groupAffairs, parseCare, resultVersion, safeSourceUrl, timeline, timelineLabel } from "./affairs";
import en from "../../../packages/i18n/src/messages/en.json";

describe("affair state precedence", () => {
  it.each<[Partial<Affair>, string]>([
    [{ openAsks: 1, status: "done" }, "waiting"],
    [{ openAsks: 0, status: "paused", agentState: "failed" }, "paused"],
    [{ openAsks: 0, status: "done", agentState: "running" }, "done"],
    [{ openAsks: 0, agentState: "failed" }, "failed"],
    [{ openAsks: 0, agentState: "running" }, "running"],
    [{ openAsks: 0, agentState: "queued" }, "queued"],
    [{ openAsks: 0, agentState: "waiting_user" }, "waiting"],
    [{ openAsks: 0, agentState: "idle" }, "active"],
    [{ openAsks: 0, agentState: "idle", status: "watching" }, "watching"],
  ])("maps %j to %s", (patch, expected) => expect(affairState({ ...affairFixture(), ...patch })).toBe(expected));
  it("distinguishes known questions and approvals, excluding closed asks", () => {
    expect(affairState(affairFixture(), [questionFixture()])).toBe("answer");
    expect(affairState(affairFixture(), [{ ...questionFixture(), kind: "approval" }])).toBe("approval");
    expect(affairState(affairFixture(), [{ ...questionFixture(), status: "answered" }])).toBe("waiting");
  });
});
it("groups and sorts without mutating, using absolute time and stable IDs", () => {
  const base = { ...affairFixture(), openAsks: 0 };
  const input = [
    { ...base, id: "done", status: "done" as const },
    { ...base, id: "older", lastActivityAt: "2026-10-15T11:00:00+08:00" },
    { ...base, id: "watching", status: "watching" as const },
    { ...base, id: "paused", status: "paused" as const },
    { ...base, id: "waiting", openAsks: 1 },
    { ...base, id: "newer", lastActivityAt: "2026-10-15T04:00:00Z" },
  ];
  const before = [...input];
  expect(groupAffairs(input).map(g => [g.key, g.items.map(a => a.id)])).toEqual([["waiting", ["waiting"]], ["active", ["newer", "older"]], ["watching", ["watching"]], ["paused", ["paused"]], ["done", ["done"]]]);
  expect(input).toEqual(before);
});
it.each(["", "4", "10081", "5.5", "NaN", "Infinity", "-1"])("rejects care interval %s", n => expect(parseCare(n, "digest")).toBeNull());
it.each(["5", "60", "10080"])("accepts care interval %s", n => expect(parseCare(n, "digest")).toEqual({ cadenceSeconds: Number(n) * 60, notify: "digest" }));
it("rejects unknown notification levels", () => expect(parseCare("60", "all")).toBeNull());
it.each([ ["user", "You"], ["source", "Source"], ["chrona", "Chrona · Request"] ] as const)("labels %s", (actor, label) => {
  expect(timelineLabel({ ...detailFixture().entries[0]!, actor }, en.steward.affairs)).toBe(label);
});
it("sorts timeline oldest first and filters resolved asks", () => {
  const d = detailFixture(), entry = d.entries[0]!;
  expect(timeline([{ ...entry, id: "late", at: "2026-10-16T00:00:00Z" }, entry]).map(e => e.id)).toEqual([entry.id, "late"]);
  expect(detailView({ ...d, asks: [{ ...questionFixture(), status: "answered" }] }).asks).toEqual([]);
});
it("rejects unsafe sources and invalid versions", () => {
  expect(safeSourceUrl("javascript:alert(1)")).toBeUndefined();
  expect(resultVersion("1.5")).toBeNull();
  expect(resultVersion("2")).toBe(2);
});

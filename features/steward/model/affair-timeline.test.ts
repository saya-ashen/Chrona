import { expect, it } from "vitest";
import { detailFixture, fixtureTime, chatFixture } from "./fixtures";
import { affairTimeline } from "./affair-timeline";
import { affairCenter, scheduleLabel } from "./affair-center";

it.each(["chrona", "user"] as const)("merges messages and groups %s edits by commit; excludes runs", actor => {
  const detail = detailFixture();
  detail.messages = chatFixture.messages;
  detail.activity = [
    { id: "a", affairId: "camera", at: fixtureTime, actor, kind: "edit", text: "internal", data: { commit: "abc", paths: ["README.md"] } },
    { id: "b", affairId: "camera", at: fixtureTime, actor, kind: "edit", text: "internal", data: { commit: "abc", paths: ["README.md", "plan.md", ".chrona/private"] } },
    { id: "run", affairId: "camera", at: fixtureTime, actor, kind: "run", text: "message finished", data: null },
  ];
  const entries = affairTimeline(detail);
  expect(entries.filter(item => item.kind === "edit")).toEqual([expect.objectContaining({ actor, paths: ["README.md", "plan.md"] })]);
  expect(entries.some(item => item.kind === "message")).toBe(true);
  expect(entries.some(item => item.id.includes("run"))).toBe(false);
  expect(entries.some(item => item.kind === "created")).toBe(true);
  expect(entries.some(item => item.kind === "approvalCreated")).toBe(true);
});
it.each(["remind", "wake", "job"] as const)("uses safe fallback for %s", mode => {
  const schedule = { ...detailFixture().schedules[0]!, mode, label: null, text: "text" };
  expect(scheduleLabel(schedule, "fallback")).toBe(mode === "remind" ? "text" : "fallback");
  expect(scheduleLabel({ ...schedule, label: "label" }, "fallback")).toBe("label");
});
it("sorts newest first and includes approval resolution once", () => {
  const detail = detailFixture();
  detail.approvals[0]!.resolvedAt = "2026-10-16T00:00:00Z";
  expect(affairTimeline(detail)[0]?.kind).toBe("approvalResolved");
});
it("uses the next schedule label or fallback without exposing internal text", () => {
  const detail = detailFixture();
  detail.affair.nextSchedule = { at: fixtureTime, mode: "wake", label: "Prepare day two" };
  detail.schedules[0] = { ...detail.schedules[0]!, mode: "wake", text: "secret instruction" };
  expect(affairCenter(detail, "fallback").nextLabel).toBe("Prepare day two");
  detail.affair.nextSchedule.label = null;
  expect(affairCenter(detail, "fallback").nextLabel).toBe("fallback");
});

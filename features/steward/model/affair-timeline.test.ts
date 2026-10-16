import { expect, it } from "vitest";
import { detailFixture, fixtureTime, chatFixture } from "./fixtures";
import { affairTimeline, timelineTime } from "./affair-timeline";
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
  if (actor === "user") expect(entries.filter(item => item.kind === "edit")).toEqual([expect.objectContaining({ actor, paths: ["README.md", "plan.md"] })]);
  // Chrona's commit lands right after its reply: shown on that reply, not as a separate row.
  else {
    expect(entries.filter(item => item.kind === "edit")).toEqual([]);
    expect(entries.find(item => item.kind === "message" && item.actor === "chrona")?.paths).toEqual(["README.md", "plan.md"]);
  }
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
it("keeps a Chrona edit as its own row when no reply is near, and formats the time column", () => {
  const detail = detailFixture();
  detail.messages = chatFixture.messages;
  const far = new Date(Date.parse(chatFixture.messages.at(-1)!.at) + 60 * 60000).toISOString();
  detail.activity = [{ id: "a", affairId: "camera", at: far, actor: "chrona", kind: "edit", text: "", data: { commit: "abc", paths: ["day.md"] } }];
  expect(affairTimeline(detail).filter(item => item.kind === "edit")).toEqual([expect.objectContaining({ paths: ["day.md"] })]);
  const now = new Date("2026-10-16T12:00:00");
  expect(timelineTime(new Date("2026-10-16T09:05:00").toISOString(), "en-GB", now)).toBe("09:05");
  expect(timelineTime(new Date("2026-10-14T09:05:00").toISOString(), "en-GB", now)).toBe("14/10");
});

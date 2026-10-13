import { expect, it } from "vitest";
import { toolActions, toolTransitionInput, canRetryNotification, canFinishFollowUp, stewardIsStale, eventRuleSpec, tablePanelSpec, hasBothSamples, toolProgress } from "./controls";
import { NOTIFICATION_STATUSES, type ToolState } from "@chrona/contracts";
it.each<[ToolState, string[]]>([["generated", ["validate"]], ["validation_failed", []], ["validated", ["authorize"]], ["authorized", ["enable"]], ["enabled", ["run", "disable"]], ["disabled", ["enable", "retire"]], ["retired", []]])("%s exposes exactly its permitted controls", (state, expected) => { expect(toolActions(state)).toEqual(expected); expect(toolProgress(state)).toHaveLength(4); });
it("sends the stored expected version", () => expect(toolTransitionInput({ version: 7 }, "authorize")).toEqual({ action: "authorize", expectedVersion: 7 }));
it.each(NOTIFICATION_STATUSES)("retry for %s only if failed", status => expect(canRetryNotification(status)).toBe(status === "failed"));
it.each(["pending", "done", "cancelled"] as const)("follow-up %s controls", status => expect(canFinishFollowUp(status)).toBe(status === "pending"));
const now = Date.parse("2026-10-13T12:00:00Z");
it.each([[null, true], ["2026-10-13T11:49:59Z", true], ["2026-10-13T11:50:00Z", false], ["2026-10-13T12:00:00Z", false]] as const)("stale tick %s", (tick, stale) => expect(stewardIsStale(tick, now)).toBe(stale));
it("builds declarative rules and requires both sample outcomes", () => {
  const cases = [{ title: "urgent", body: "", author: "", expectMatch: true }, { title: "hello", body: "", author: "", expectMatch: false }];
  expect(hasBothSamples(cases)).toBe(true); expect(hasBothSamples(cases.slice(0, 1))).toBe(false);
  expect(eventRuleSpec(" urgent, urgent, ", "", "retain", "Keep", cases)).toEqual({ type: "event_rule", match: { anyKeywords: ["urgent"] }, then: { disposition: "retain", note: "Keep" }, cases });
  expect(tablePanelSpec(["title"], "affair_events", { title: "Title", author: "Author", occurredAt: "Date", status: "Status", note: "Note" })).toEqual({ type: "table_panel", columns: [{ key: "title", label: "Title" }], source: "affair_events" });
});

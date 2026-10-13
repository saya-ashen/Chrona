import { describe, expect, it } from "vitest";
import { AFFAIR_STATUSES, TOOL_STATES, SCHEDULE_ITEM_KINDS, type AffairDetail, type ScheduleItem } from "@chrona/contracts";
import en from "@chrona/i18n/messages/en.json";
import { affairStatusOptions, deriveAffair, isNotFound, parseKeywords, toolStateLabel } from "./affairs";
import { groupScheduleDays, localDayKey, scheduleNeedsConfirmation, stewardScheduleRange } from "./schedule";

it.each([[" a, b, ,a ", ["a", "b"]], ["", []], ["旅行, 计划", ["旅行", "计划"]]])("parses keywords %s", (input, result) => { expect(parseKeywords(input as string)).toEqual(result); });
it.each(AFFAIR_STATUSES)("offers status %s", value => { expect(affairStatusOptions(en.steward.statuses)).toContainEqual({ value, label: en.steward.statuses[value] }); });
it.each(TOOL_STATES)("preserves tool state %s", state => { expect(toolStateLabel(state, en.steward.toolStates)).toBe(en.steward.toolStates[state]); });
it("tool labels are distinct", () => { expect(new Set(TOOL_STATES.map(state => toolStateLabel(state, en.steward.toolStates))).size).toBe(TOOL_STATES.length); });
it.each([[{ status: 404 }, true], [{ status: 500 }, false], [null, false], [new Error("404"), false]])("recognizes not-found without masking errors", (error, expected) => { expect(isNotFound(error)).toBe(expected); });
it.each([0, 1])("shows suggestions only when present (%s)", count => {
  const detail = { attention: [{ status: "open" }, { status: "resolved" }, { status: "snoozed" }], events: [{ linkStatus: "confirmed" }, { linkStatus: "suggested" }], suggestedEvents: Array.from({ length: count }, () => ({ linkStatus: "suggested" })) } as AffairDetail;
  const view = deriveAffair(detail); expect(view.attention).toHaveLength(1); expect(view.events).toHaveLength(1); expect(view.showSuggestions).toBe(count > 0);
});
function item(startsAt: string, id = startsAt): ScheduleItem { return { id, title: id, startsAt, endsAt: null, kind: "appointment", affairId: null, sourceRef: null, confirmed: true }; }
describe("local calendar grouping", () => {
  it.each([{ items: [] }, { items: [item(new Date(2026, 9, 13, 23).toISOString()), item(new Date(2026, 9, 14, 1).toISOString())] }])("groups using device dates", ({ items }) => {
    const groups = groupScheduleDays([...items].reverse()); expect(groups.map(group => group.day)).toEqual(items.map(value => localDayKey(new Date(value.startsAt))));
  });
  it("orders same-day items without mutating input", () => { const late = item(new Date(2026, 9, 13, 18).toISOString()), early = item(new Date(2026, 9, 13, 8).toISOString()); const input = [late, early]; expect(groupScheduleDays(input)[0].items).toEqual([early, late]); expect(input).toEqual([late, early]); });
  it.each([new Date(2026, 2, 1, 20), new Date(2026, 9, 30, 20)])("requests 14 calendar days through clock changes", now => { const range = stewardScheduleRange(now); const start = new Date(range.from), end = new Date(range.to); const expected = new Date(start); expected.setDate(expected.getDate() + 14); expect(end).toEqual(expected); expect(start.getHours()).toBe(0); expect(end.getHours()).toBe(0); });
});
it.each(SCHEDULE_ITEM_KINDS)("marks confirmation correctly for %s", kind => { expect(scheduleNeedsConfirmation({ ...item("2026-10-13T00:00:00Z"), kind })).toBe(kind === "unconfirmed_suggestion"); expect(scheduleNeedsConfirmation({ ...item("2026-10-13T00:00:00Z"), kind, confirmed: false })).toBe(true); });

import { describe, expect, test } from "bun:test";
import { ATTENTION_KINDS, DELEGATION_STATUSES, scheduleItemSchema } from "@chrona/contracts/steward";
import { buildSchedule, type ScheduleInput } from "./schedule";

const NOW = "2026-10-14T12:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString();
const range = { from: NOW, to: at(24) };
const appointment = { id: "calendar", title: "Meeting", startsAt: at(2), endsAt: at(3), affairId: "a" };
const attention = { id: "attention", title: "Prepare", kind: "commitment" as const, status: "open" as const, dueAt: at(3), affairId: "a" };
const followUp = { id: "follow", note: "Ask for update", status: "pending" as const, dueAt: at(4), affairId: "a" };
const delegation = { id: "delegation", purpose: "Watch changes", status: "active" as const, lastCheckAt: at(-1), cadenceSeconds: 7200, affairId: "a" };
function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return { now: NOW, calendarEvents: [], attentionItems: [], followUps: [], delegations: [], ...overrides };
}

describe("pure schedule projection", () => {
  test.each([
    ["appointment", input({ calendarEvents: [appointment] }), true, "calendar", at(2)],
    ["deadline", input({ attentionItems: [attention] }), true, "attention", at(3)],
    ["unconfirmed_suggestion", input({ attentionItems: [{ ...attention, kind: "decision" }] }), false, "attention", at(3)],
    ["unconfirmed_suggestion", input({ attentionItems: [{ ...attention, kind: "suggestion" }] }), false, "attention", at(3)],
    ["follow_up", input({ followUps: [followUp] }), true, "follow", at(4)],
    ["steward_check", input({ delegations: [delegation] }), true, "delegation", at(1)],
    ["steward_check", input({ delegations: [{ ...delegation, lastCheckAt: null }] }), true, "delegation", NOW],
  ] as const)("%s from source %#", (kind, source, confirmed, sourceId, startsAt) => {
    const result = buildSchedule(source, range);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: `${kind}:${sourceId}`, kind, confirmed, startsAt, affairId: "a", sourceRef: sourceId });
    expect(scheduleItemSchema.safeParse(result[0]).success).toBe(true);
    expect(result[0].endsAt).toBe(kind === "appointment" ? at(3) : null);
  });
  test.each([...ATTENTION_KINDS])("only commitment dates are confirmed: %s", kind => {
    const result = buildSchedule(input({ attentionItems: [{ ...attention, kind }] }), range)[0];
    expect(result.kind).toBe(kind === "commitment" ? "deadline" : "unconfirmed_suggestion");
    expect(result.confirmed).toBe(kind === "commitment");
  });
  test.each(["open", "snoozed", "resolved", "dismissed"] as const)("attention status %s", status => {
    expect(buildSchedule(input({ attentionItems: [{ ...attention, status }] }), range)).toHaveLength(status === "open" || status === "snoozed" ? 1 : 0);
  });
  test("undated attention is not scheduled", () => {
    expect(buildSchedule(input({ attentionItems: [{ ...attention, dueAt: null }] }), range)).toEqual([]);
  });
  test.each(["pending", "done", "cancelled"] as const)("follow-up status %s", status => {
    expect(buildSchedule(input({ followUps: [{ ...followUp, status }] }), range)).toHaveLength(status === "pending" ? 1 : 0);
  });
  test.each([...DELEGATION_STATUSES])("delegation status %s", status => {
    expect(buildSchedule(input({ delegations: [{ ...delegation, status }] }), range)).toHaveLength(status === "active" ? 1 : 0);
  });
  test.each([null, 0, -1, NaN, Infinity])("unscheduled/invalid cadence %s", cadenceSeconds => {
    expect(buildSchedule(input({ delegations: [{ ...delegation, cadenceSeconds }] }), range)).toEqual([]);
  });
  test.each([at(-1), NOW, at(1)])("delegation expired before now or next check: %s", expiresAt => {
    expect(buildSchedule(input({ delegations: [{ ...delegation, expiresAt }] }), range)).toEqual([]);
  });
  test.each([-1, 0, 23, 24])("[from,to) applies to every kind at hour %s", hour => {
    const s = input({
      calendarEvents: [{ ...appointment, startsAt: at(hour) }],
      attentionItems: [{ ...attention, dueAt: at(hour) }, { ...attention, id: "unconfirmed", kind: "suggestion", dueAt: at(hour) }],
      followUps: [{ ...followUp, dueAt: at(hour) }],
      delegations: [{ ...delegation, lastCheckAt: at(hour - 2) }],
    });
    expect(buildSchedule(s, range)).toHaveLength(hour >= 0 && hour < 24 ? 5 : 0);
  });
  test("sort compares instants, then stable IDs; projections preserve input and IDs across runs", () => {
    const s = input({
      calendarEvents: [{ ...appointment, startsAt: "2026-10-14T15:00:00+02:00" }],
      attentionItems: [attention], followUps: [followUp], delegations: [delegation],
    });
    const before = structuredClone(s);
    const result = buildSchedule(s, range);
    expect(result.map(i => i.kind)).toEqual(["appointment", "steward_check", "deadline", "follow_up"]);
    expect(buildSchedule({ ...s, now: at(0.01) }, range)).toEqual(result);
    expect(s).toEqual(before);
    const neverChecked = input({ delegations: [{ ...delegation, lastCheckAt: null }] });
    expect(buildSchedule(neverChecked, range)[0].id).toBe(buildSchedule({ ...neverChecked, now: at(1) }, range)[0].id);
  });
  test("empty input and empty or reversed intervals return no items", () => {
    expect(buildSchedule(input(), range)).toEqual([]);
    const s = input({ calendarEvents: [appointment] });
    expect(buildSchedule(s, { from: NOW, to: NOW })).toEqual([]);
    expect(buildSchedule(s, { from: at(24), to: NOW })).toEqual([]);
  });
  test("contract titles remain bounded when source notes/purposes are long", () => {
    const result = buildSchedule(input({ followUps: [{ ...followUp, note: "n".repeat(4000) }], delegations: [{ ...delegation, purpose: "p".repeat(4000) }] }), range);
    expect(result).toHaveLength(2);
    for (const item of result) expect(scheduleItemSchema.safeParse(item).success).toBe(true);
  });
});

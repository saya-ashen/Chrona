import { describe, expect, test } from "bun:test";
import { chooseHandling } from "./handling";
import {
  applyRestraint, detectApproachingDeadlines, detectRepeatedManualWork, detectSeasonOver,
  detectStalledGoals, detectSuggestions, detectWrapUpAfterAction, suggestionDedupeFamily,
  type SuggestionCandidate, type SuggestionDecision, type SuggestionSnapshot,
} from "./suggestions";

const NOW = "2026-10-14T12:00:00.000Z";
const HOUR = 3_600_000;
const at = (hours: number) => new Date(Date.parse(NOW) + hours * HOUR).toISOString();
const affair = { id: "a", title: "Research", status: "active" as const, goal: "Finish research", updatedAt: at(-24) };
const attention = { id: "decision", affairId: "a", kind: "decision" as const, status: "open" as const, dueAt: null, createdAt: at(-24), decidedAt: null };
const followUp = { id: "follow", affairId: "a", dueAt: at(24), status: "pending" as const, createdAt: at(-24) };
const events = [1, 2, 3].map(n => ({ id: `event${n}`, affairId: "a", occurredAt: at(-n * 24), disposition: "act" as const, pattern: "weekly:report" }));
function snapshot(overrides: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return { affairs: [affair], attentionItems: [], followUps: [], assessedEvents: [], activeDelegations: [], recentDecisions: [], managedTools: [], ...overrides };
}
const deadline = () => snapshot({ attentionItems: [attention, { ...attention, id: "commitment", kind: "commitment", dueAt: at(72) }] });
const stalled = () => snapshot({ affairs: [{ ...affair, updatedAt: at(-15 * 24) }] });
const repeated = () => snapshot({ assessedEvents: events });
const wrapUp = () => snapshot({ attentionItems: [{ ...attention, status: "resolved", decidedAt: at(-24) }], followUps: [followUp] });
const season = () => snapshot({ affairs: [{ ...affair, status: "closed" }], activeDelegations: [{ id: "delegation", affairId: "a" }] });

type Detector = (snapshot: SuggestionSnapshot, now: string) => SuggestionCandidate[];
const detectorCases: [string, Detector, () => SuggestionSnapshot, (s: SuggestionSnapshot) => SuggestionSnapshot][] = [
  ["deadline", detectApproachingDeadlines, deadline, s => ({ ...s, attentionItems: [attention, { ...attention, id: "commitment", kind: "commitment", dueAt: at(72 + 1 / 3600) }] })],
  ["stalled goal", detectStalledGoals, stalled, s => ({ ...s, affairs: [{ ...affair, updatedAt: at(-14 * 24 + 1 / 3600) }] })],
  ["repeated work", detectRepeatedManualWork, repeated, s => ({ ...s, assessedEvents: events.slice(0, 2) })],
  ["wrap-up", detectWrapUpAfterAction, wrapUp, s => ({ ...s, attentionItems: [{ ...attention, status: "resolved", decidedAt: at(-48 - 1 / 3600) }] })],
  ["season over", detectSeasonOver, season, s => ({ ...s, affairs: [affair] })],
];
describe("suggestion detectors", () => {
  test.each(detectorCases)("%s: positive, near miss, stable keys, no mutation", (_label, detector, make, miss) => {
    const input = make();
    const before = structuredClone(input);
    const results = detector(input, NOW);
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe("suggestion");
    expect(results[0].dedupeKey).toMatch(/^suggest:[^:]+:a:[^:]+$/);
    // A later tick with unchanged facts must preserve the bucket.
    const next = detector(input, at(1 / 60));
    expect(next.map(c => c.dedupeKey)).toEqual(results.map(c => c.dedupeKey));
    expect(detector(miss(input), NOW)).toEqual([]);
    expect(input).toEqual(before);
  });

  test.each(["commitment", "decision", "follow_up"] as const)("deadline source %s requires another open decision", kind => {
    const due = { ...attention, id: "due", dueAt: at(1) };
    const s = kind === "follow_up"
      ? snapshot({ attentionItems: [attention], followUps: [followUp] })
      : snapshot({ attentionItems: [attention, { ...due, kind }] });
    expect(detectApproachingDeadlines(s, NOW)).toHaveLength(1);
    expect(detectApproachingDeadlines({ ...s, attentionItems: s.attentionItems.filter(i => i.id !== attention.id) }, NOW)).toEqual([]);
  });
  test.each([-1, 73])("deadline excludes due hour %s", hour => {
    expect(detectApproachingDeadlines(snapshot({ attentionItems: [attention], followUps: [{ ...followUp, dueAt: at(hour) }] }), NOW)).toEqual([]);
  });
  test("deadline ignores done follow-ups, snoozed preparation and closed affairs", () => {
    expect(detectApproachingDeadlines(snapshot({ attentionItems: [attention], followUps: [{ ...followUp, status: "done" }] }), NOW)).toEqual([]);
    expect(detectApproachingDeadlines(snapshot({ attentionItems: [{ ...attention, status: "snoozed" }], followUps: [followUp] }), NOW)).toEqual([]);
    expect(detectApproachingDeadlines({ ...deadline(), affairs: [{ ...affair, status: "closed" }] }, NOW)).toEqual([]);
  });
  test("material deadline change changes bucket but not restraint family", () => {
    const a = detectApproachingDeadlines(deadline(), NOW)[0];
    const s = deadline();
    const b = detectApproachingDeadlines({ ...s, attentionItems: s.attentionItems.map(i => i.dueAt ? { ...i, dueAt: at(48) } : i) }, NOW)[0];
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(suggestionDedupeFamily(a.dedupeKey)).toBe(suggestionDedupeFamily(b.dedupeKey));
  });
  test.each([
    { assessedEvents: [events[0]] },
    { attentionItems: [attention] },
    { attentionItems: [{ ...attention, createdAt: at(-30 * 24), decidedAt: at(-1), status: "resolved" as const }] },
    { followUps: [followUp] },
    { followUps: [{ ...followUp, createdAt: at(-30 * 24), updatedAt: at(-1), status: "done" as const }] },
    { affairs: [{ ...affair, updatedAt: at(-30 * 24), goal: " " }] },
    { affairs: [{ ...affair, updatedAt: at(-30 * 24), status: "watching" as const }] },
  ])("stalled excludes recent activity or ineligible goal %#", override => {
    expect(detectStalledGoals({ ...stalled(), ...override }, NOW)).toEqual([]);
  });
  test("stalled exact threshold and UTC ISO week across year boundary", () => {
    expect(detectStalledGoals(snapshot({ affairs: [{ ...affair, updatedAt: at(-14 * 24) }] }), NOW)).toHaveLength(1);
    const s = snapshot({ affairs: [{ ...affair, updatedAt: "2025-01-01T00:00:00Z" }] });
    const key = (now: string) => detectStalledGoals(s, now)[0].dedupeKey;
    expect(key("2025-12-29T12:00:00Z")).toBe(key("2026-01-04T12:00:00Z"));
    expect(key("2026-01-05T12:00:00Z")).not.toBe(key("2026-01-04T12:00:00Z"));
  });

  test.each([
    { activeDelegations: [{ id: "d", affairId: "a" }] },
    { managedTools: [{ id: "t", affairId: "a", state: "enabled" as const }] },
    { assessedEvents: events.map(e => ({ ...e, occurredAt: at(-14 * 24 - 1) })) },
    { assessedEvents: events.map(e => ({ ...e, occurredAt: at(1) })) },
    { assessedEvents: events.map(e => ({ ...e, pattern: e.id })) },
    { assessedEvents: events.map(e => ({ ...e, affairId: e.id })) },
    { assessedEvents: events.map(e => ({ ...e, pattern: " " })) },
    { assessedEvents: [events[0], events[0], events[1]] },
  ])("repetition excludes coverage, unrelated, duplicate or out-of-window events %#", override => {
    expect(detectRepeatedManualWork({ ...repeated(), ...override }, NOW)).toEqual([]);
  });
  test.each(["act", "await_decision", "retain", "digest", "notify_now"] as const)("repeated %s uses policy choice and rationale", disposition => {
    const observation = disposition !== "act" && disposition !== "await_decision";
    const result = detectRepeatedManualWork(snapshot({ assessedEvents: events.map(e => ({ ...e, disposition, occurredAt: at(-14 * 24) })) }), NOW)[0];
    const expected = chooseHandling({ repeatsExpected: "recurring", rulesStable: true, needsOngoingObservation: observation,
      needsUserInteraction: disposition === "await_decision" ? "compare_or_fill" : "none", ambiguity: "clear", existingToolFits: false,
      risk: disposition === "act" ? "high" : "low", valueWorthKeeping: true });
    expect(result.handling).toEqual(expected);
    expect(result.whyItMatters).toBe(expected.rationale);
    expect(result.proposes).toBe(observation ? "propose_delegation" : "propose_tool");
    expect(result.nextStep).toContain("Granting access is a separate step");
    expect(result.evidenceEventIds).toEqual(["event1", "event2", "event3"]);
  });
  test("unenabled tools and other affairs do not cover repetition; input order and new evidence do not churn keys", () => {
    const s = { ...repeated(), managedTools: [{ id: "t", affairId: "a", state: "authorized" as const }], activeDelegations: [{ id: "d", affairId: "other" }] };
    const result = detectRepeatedManualWork(s, NOW);
    expect(result).toHaveLength(1);
    expect(detectRepeatedManualWork({ ...s, assessedEvents: [...events].reverse() }, NOW)).toEqual(result);
    expect(detectRepeatedManualWork({ ...s, assessedEvents: [...events, { ...events[0], id: "event4" }] }, NOW)[0].dedupeKey).toBe(result[0].dedupeKey);
  });

  test.each([
    { attentionItems: [] },
    { attentionItems: [{ ...attention, status: "resolved" as const, decidedAt: null }] },
    { attentionItems: [{ ...attention, status: "resolved" as const, decidedAt: at(1) }] },
    { attentionItems: [{ ...attention, status: "dismissed" as const, decidedAt: at(-1) }] },
    { attentionItems: [{ ...attention, status: "resolved" as const, decidedAt: at(-1) }, { ...attention, id: "still-open" }] },
    { followUps: [] },
  ])("wrap-up requires proof all decisions recently resolved and something pending %#", override => {
    expect(detectWrapUpAfterAction({ ...wrapUp(), ...override }, NOW)).toEqual([]);
  });
  test.each([
    { activeDelegations: [{ id: "d", affairId: "a" }] },
    { managedTools: [{ id: "t", affairId: "a", state: "enabled" as const }] },
  ])("wrap-up at 48h includes ongoing resources %#", resources => {
    expect(detectWrapUpAfterAction(snapshot({ attentionItems: [{ ...attention, status: "resolved", decidedAt: at(-48) }], ...resources }), NOW)).toHaveLength(1);
  });
  test.each(["closed", "paused"] as const)("season over for %s with enabled tools", status => {
    const s = snapshot({ affairs: [{ ...affair, status }], managedTools: [{ id: "t", affairId: "a", state: "enabled" }] });
    expect(detectSeasonOver(s, NOW)).toHaveLength(1);
    expect(detectSeasonOver({ ...s, managedTools: [{ id: "t", affairId: "a", state: "disabled" }] }, NOW)).toEqual([]);
  });
});

const candidates = detectorCases.map(([, detector, make]) => detector(make(), NOW)[0]);
const family = suggestionDedupeFamily(candidates[0].dedupeKey);
describe("restraint", () => {
  const restraintCases: [SuggestionDecision["decision"], number, string | undefined, boolean][] = [
    ["dismiss", -14 * 24 + 1, undefined, true], ["dismissed", -1, undefined, true],
    ["decline", -1, undefined, true], ["declined", -1, undefined, true],
    ["dismiss", -14 * 24, undefined, false], ["decline", -14 * 24, undefined, false],
    ["less_often", -30 * 24 + 1, undefined, true], ["less_often", -30 * 24, undefined, false],
    ["snooze", -40 * 24, at(1), true], ["snoozed", -1, at(1), true],
    ["snooze", -1, NOW, false], ["snooze", -1, at(-0.5), false],
    ["snooze", -1, undefined, true], ["snooze", -1, "invalid", true],
    ["approve", -1, undefined, false], ["done", -1, undefined, false],
    ["dismiss", 1, undefined, false],
  ];
  test.each(restraintCases)("%s at %s hours, snooze %s, suppressed %s", (decision, hours, snoozedUntil, suppressed) => {
    expect(applyRestraint([candidates[0]], [{ dedupeFamily: family, decision, decidedAt: at(hours), snoozedUntil }], NOW)).toHaveLength(suppressed ? 0 : 1);
  });
  test("family suppression crosses buckets, not affairs or detectors", () => {
    const changed = { ...candidates[0], dedupeKey: `${family}:changed` };
    const other = { ...candidates[0], dedupeKey: "suggest:deadline:other:changed" };
    const decisions: SuggestionDecision[] = [{ dedupeFamily: family, decision: "dismiss", decidedAt: at(-1) }];
    expect(applyRestraint([changed, other, candidates[1]], decisions, NOW)).toEqual([other, candidates[1]]);
  });
  test("urgency, stable lexical ties, default cap, deduplication and immutability", () => {
    const [a, b, c, d, e] = candidates;
    const tie = { ...a, dedupeKey: "suggest:deadline:a:aaa" };
    const input = [b, e, d, c, tie, a, a];
    const before = structuredClone(input);
    expect(applyRestraint(input, [], NOW)).toEqual([a, tie, c]);
    expect(applyRestraint(input, [], NOW, { maxPerRun: 10 })).toEqual([a, tie, c, d, e, b]);
    expect(applyRestraint(input, [], NOW, { maxPerRun: 0 })).toEqual([]);
    expect(input).toEqual(before);
  });
  test.each([-1, 1.5, NaN, Infinity])("invalid cap %s is rejected", maxPerRun => {
    expect(() => applyRestraint(candidates, [], NOW, { maxPerRun })).toThrow(RangeError);
  });
  test("orchestrator applies restraint after detection", () => {
    const s = { ...deadline(), assessedEvents: events, recentDecisions: [{ dedupeFamily: family, decision: "dismiss" as const, decidedAt: at(-1) }] };
    expect(detectSuggestions(s, NOW)).toEqual(detectRepeatedManualWork(s, NOW));
  });
  test("empty snapshot has no suggestions", () => expect(detectSuggestions(snapshot({ affairs: [] }), NOW)).toEqual([]));
});

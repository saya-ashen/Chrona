import type { Affair, AttentionItem, Delegation, Disposition, FollowUp, ManagedTool } from "@chrona/contracts/steward";
import { chooseHandling, type HandlingChoice } from "./handling";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Inclusive upcoming deadline horizon; overdue items are handled elsewhere. */
export const DEADLINE_HORIZON_MS = 72 * HOUR_MS;
/** A goal becomes stalled after at least fourteen days without activity. */
export const STALLED_AFTER_MS = 14 * DAY_MS;
/** Repetition includes events exactly fourteen days old, but never future events. */
export const REPETITION_WINDOW_MS = 14 * DAY_MS;
export const MIN_REPEATED_EVENTS = 3;
/** Every decision must have been resolved within this inclusive window. */
export const WRAP_UP_WINDOW_MS = 48 * HOUR_MS;
/** Cooldowns expire exactly at their boundary. */
export const DISMISS_COOLDOWN_MS = 14 * DAY_MS;
export const LESS_OFTEN_COOLDOWN_MS = 30 * DAY_MS;
export const DEFAULT_MAX_PER_RUN = 3;

export type SuggestionCandidate = {
  dedupeKey: string;
  kind: "suggestion";
  affairId: string;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  nextStep: string;
  evidenceEventIds: string[];
  proposes: "none" | "propose_delegation" | "propose_tool";
  handling?: HandlingChoice;
};
export type SuggestionDecision = {
  dedupeFamily: string;
  decision: NonNullable<AttentionItem["decision"]> | "dismissed" | "declined" | "snoozed";
  decidedAt: string;
  snoozedUntil?: string | null;
};
/**
 * Caller supplies complete attention history (including resolved decisions), not
 * only open items, and at least the last thirty days of assessed events/activity.
 * IDs and decidedAt are required for evidence, stable buckets and wrap-up proof.
 * Follow-up updatedAt, when available, captures completion/cancellation activity.
 */
export type SuggestionSnapshot = {
  affairs: readonly Pick<Affair, "id" | "title" | "status" | "goal" | "updatedAt">[];
  attentionItems: readonly (Pick<AttentionItem, "id" | "affairId" | "kind" | "status" | "dueAt" | "createdAt" | "decidedAt"> & Partial<Pick<AttentionItem, "updatedAt" | "eventId">>)[];
  followUps: readonly (Pick<FollowUp, "id" | "affairId" | "dueAt" | "status" | "createdAt"> & { updatedAt?: string })[];
  assessedEvents: readonly { id: string; affairId: string | null; occurredAt: string; disposition: Disposition; pattern: string }[];
  activeDelegations: readonly Pick<Delegation, "id" | "affairId">[];
  recentDecisions: readonly SuggestionDecision[];
  managedTools: readonly Pick<ManagedTool, "id" | "affairId" | "state">[];
};
type SnapshotAffair = SuggestionSnapshot["affairs"][number];
const priorities = { deadline: 0, repeated_manual: 1, wrap_up: 2, season_over: 3, stalled_goal: 4 } as const;
type Detector = keyof typeof priorities;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const ongoing = (affair: SnapshotAffair) => affair.status === "active" || affair.status === "watching";
const withinPast = (date: string, now: number, window: number) => {
  const age = now - Date.parse(date);
  return age >= 0 && age <= window;
};
const bucket = (facts: unknown) => encodeURIComponent(JSON.stringify(facts));

/** Family spans fact buckets so a dismissal also restrains a changed deadline. */
export function suggestionDedupeFamily(dedupeKey: string): string {
  return dedupeKey.slice(0, dedupeKey.lastIndexOf(":"));
}
function candidate(detector: Detector, affair: SnapshotAffair, facts: unknown, whatHappened: string, whyItMatters: string, nextStep: string): SuggestionCandidate {
  return {
    dedupeKey: `suggest:${detector}:${encodeURIComponent(affair.id)}:${bucket(facts)}`,
    kind: "suggestion", affairId: affair.id, title: affair.title,
    whatHappened, whyItMatters, nextStep, evidenceEventIds: [], proposes: "none",
  };
}
function coverage(snapshot: SuggestionSnapshot, affairId: string): string[] {
  return [
    ...snapshot.activeDelegations.filter(d => d.affairId === affairId).map(d => `delegation:${d.id}`),
    ...snapshot.managedTools.filter(t => t.affairId === affairId && t.state === "enabled").map(t => `tool:${t.id}`),
  ].sort(compare);
}

export function detectApproachingDeadlines(snapshot: SuggestionSnapshot, now: string): SuggestionCandidate[] {
  const time = Date.parse(now);
  return snapshot.affairs.filter(ongoing).flatMap(affair => {
    const open = snapshot.attentionItems.filter(i => i.affairId === affair.id && i.status === "open");
    const due = [
      ...open.filter(i => i.kind === "commitment" || i.kind === "decision").map(i => ({ ...i, source: "attention" })),
      ...snapshot.followUps.filter(f => f.affairId === affair.id && f.status === "pending").map(f => ({ ...f, source: "follow_up" })),
    ];
    return due.filter(i => {
      const remaining = i.dueAt === null ? NaN : Date.parse(i.dueAt) - time;
      return remaining >= 0 && remaining <= DEADLINE_HORIZON_MS && open.some(d => d.kind === "decision" && (i.source !== "attention" || d.id !== i.id));
    }).map(i => candidate("deadline", affair, [i.source, i.id, i.dueAt],
      "A deadline is within 72 hours while preparation decisions remain open.",
      "Unfinished preparation could prevent meeting the deadline.",
      "Finish preparation or decide the remaining questions before the deadline."));
  });
}

/** UTC ISO week changes weekly, not at each scheduler tick. */
function isoWeek(now: string): string {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export function detectStalledGoals(snapshot: SuggestionSnapshot, now: string): SuggestionCandidate[] {
  const time = Date.parse(now);
  return snapshot.affairs.filter(a => a.status === "active" && a.goal.trim()).flatMap(affair => {
    const activity = [affair.updatedAt,
      ...snapshot.assessedEvents.filter(e => e.affairId === affair.id).map(e => e.occurredAt),
      ...snapshot.attentionItems.filter(i => i.affairId === affair.id).flatMap(i => [i.createdAt, i.updatedAt, i.decidedAt]),
      ...snapshot.followUps.filter(f => f.affairId === affair.id).flatMap(f => [f.createdAt, f.updatedAt]),
    ].filter((date): date is string => typeof date === "string").map(Date.parse);
    // Future or invalid activity cannot establish a period of inactivity.
    if (!activity.every(t => Number.isFinite(t) && time - t >= STALLED_AFTER_MS)) return [];
    return [candidate("stalled_goal", affair, isoWeek(now),
      "This active goal has had no recorded activity for at least 14 days.",
      "A check-in can clarify whether the goal still deserves attention.",
      "Check in on progress, or consider pausing or closing the affair.")];
  });
}

export function detectRepeatedManualWork(snapshot: SuggestionSnapshot, now: string): SuggestionCandidate[] {
  const time = Date.parse(now);
  return snapshot.affairs.filter(ongoing).flatMap(affair => {
    if (coverage(snapshot, affair.id).length) return [];
    const patterns = new Map<string, Map<string, SuggestionSnapshot["assessedEvents"][number]>>();
    for (const event of snapshot.assessedEvents) {
      if (event.affairId !== affair.id || !event.pattern.trim() || !withinPast(event.occurredAt, time, REPETITION_WINDOW_MS)) continue;
      const events = patterns.get(event.pattern) ?? new Map();
      events.set(event.id, event);
      patterns.set(event.pattern, events);
    }
    return [...patterns].flatMap(([pattern, byId]) => {
      const events = [...byId.values()];
      if (events.length < MIN_REPEATED_EVENTS) return [];
      // A normalized recurring pattern is the only evidence of stable rules.
      // Informational dispositions indicate observation; act/await_decision
      // indicate repeated work. Neither inference authorizes execution.
      const handling = chooseHandling({
        repeatsExpected: "recurring", rulesStable: true,
        needsOngoingObservation: events.every(e => e.disposition !== "act" && e.disposition !== "await_decision"),
        needsUserInteraction: events.some(e => e.disposition === "await_decision") ? "compare_or_fill" : "none",
        ambiguity: "clear", existingToolFits: false,
        risk: events.some(e => e.disposition === "act") ? "high" : "low", valueWorthKeeping: true,
      });
      return [{ ...candidate("repeated_manual", affair, pattern,
        "The same assessed pattern occurred at least three times in 14 days.",
        handling.rationale,
        "Review this proposal first. Granting access is a separate step; nothing is enabled or authorized by this suggestion."),
        evidenceEventIds: events.map(e => e.id).sort(compare), handling,
        proposes: handling.mode === "delegation" ? "propose_delegation" as const : "propose_tool" as const,
      }];
    });
  });
}

export function detectWrapUpAfterAction(snapshot: SuggestionSnapshot, now: string): SuggestionCandidate[] {
  return snapshot.affairs.filter(ongoing).flatMap(affair => {
    const decisions = snapshot.attentionItems.filter(i => i.affairId === affair.id && i.kind === "decision");
    if (!decisions.length || !decisions.every(i => i.status === "resolved" && i.decidedAt !== null && withinPast(i.decidedAt, Date.parse(now), WRAP_UP_WINDOW_MS))) return [];
    const pending = snapshot.followUps.filter(f => f.affairId === affair.id && f.status === "pending");
    const resources = coverage(snapshot, affair.id);
    if (!pending.length && !resources.length) return [];
    return [candidate("wrap_up", affair,
      [decisions.map(i => `${i.id}:${i.decidedAt}`).sort(compare), pending.map(f => f.id).sort(compare), resources],
      "All decisions were resolved within 48 hours, but follow-ups or ongoing services remain.",
      "Loose ends can keep work running after its purpose has been fulfilled.",
      "Review pending follow-ups, pause the delegation, disable then retire the tool, or mark the affair done as appropriate.")];
  });
}

export function detectSeasonOver(snapshot: SuggestionSnapshot, _now: string): SuggestionCandidate[] {
  return snapshot.affairs.filter(a => a.status === "closed" || a.status === "paused").flatMap(affair => {
    const resources = coverage(snapshot, affair.id);
    return resources.length ? [candidate("season_over", affair, [affair.status, resources],
      "This paused or closed affair still has active delegations or enabled tools.",
      "Ongoing checks may no longer serve the affair's purpose.",
      "Review and pause the remaining delegations or disable the enabled tools.")] : [];
  });
}

export function applyRestraint(candidates: readonly SuggestionCandidate[], recentDecisions: readonly SuggestionDecision[], now: string, { maxPerRun = DEFAULT_MAX_PER_RUN }: { maxPerRun?: number } = {}): SuggestionCandidate[] {
  if (!Number.isInteger(maxPerRun) || maxPerRun < 0) throw new RangeError("maxPerRun must be a non-negative integer");
  const time = Date.parse(now);
  const priority = (c: SuggestionCandidate) => priorities[c.dedupeKey.split(":")[1] as Detector] ?? Number.MAX_SAFE_INTEGER;
  const seen = new Set<string>();
  return candidates.filter(c => !recentDecisions.some(d => {
    if (d.dedupeFamily !== suggestionDedupeFamily(c.dedupeKey)) return false;
    const age = time - Date.parse(d.decidedAt);
    if (!(age >= 0)) return false;
    switch (d.decision) {
      case "dismiss": case "dismissed": case "decline": case "declined": return age < DISMISS_COOLDOWN_MS;
      case "less_often": return age < LESS_OFTEN_COOLDOWN_MS;
      // Missing/invalid expiry cannot safely establish that a snooze has ended.
      case "snooze": case "snoozed": return !d.snoozedUntil || !Number.isFinite(Date.parse(d.snoozedUntil)) || time < Date.parse(d.snoozedUntil);
      default: return false;
    }
  })).sort((a, b) => priority(a) - priority(b) || compare(a.dedupeKey, b.dedupeKey))
    .filter(c => { if (seen.has(c.dedupeKey)) return false; seen.add(c.dedupeKey); return true; })
    .slice(0, maxPerRun);
}

export function detectSuggestions(snapshot: SuggestionSnapshot, now: string): SuggestionCandidate[] {
  return applyRestraint([
    ...detectApproachingDeadlines(snapshot, now), ...detectStalledGoals(snapshot, now),
    ...detectRepeatedManualWork(snapshot, now), ...detectWrapUpAfterAction(snapshot, now),
    ...detectSeasonOver(snapshot, now),
  ], snapshot.recentDecisions, now);
}

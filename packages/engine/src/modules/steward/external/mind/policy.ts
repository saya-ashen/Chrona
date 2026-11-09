import type { Concern, Decision, Signal, State } from "./types";
export const DAY = 86_400_000;
export const openConcern = (concern: Concern) => concern.status !== "done" && concern.status !== "dropped";
export const freshSignal = (signal: Signal, now: number) => now >= Date.parse(signal.occurredAt) && now - Date.parse(signal.occurredAt) <= 7 * DAY;
export function currentSignal(state: State, signal: Signal, now: number) {
  const position = state.signals.findIndex(item => item.id === signal.id);
  const identity = ["moduleId", "source", "event", "ref", "thread", "from", "domain", "kind"] as const;
  return freshSignal(signal, now) && !state.signals.some((other, index) => identity.every(field => other[field] === signal[field])
    && (Date.parse(other.occurredAt) > Date.parse(signal.occurredAt) || Date.parse(other.occurredAt) === Date.parse(signal.occurredAt)
      && (Date.parse(other.receivedAt) > Date.parse(signal.receivedAt) || Date.parse(other.receivedAt) === Date.parse(signal.receivedAt) && index > position)));
}
export function matches(concern: Concern, signal: Signal): boolean {
  return openConcern(concern) && concern.awaiting.some(rule =>
    rule.source === signal.source && rule.moduleId === signal.moduleId && rule.event === signal.event && rule.ref === signal.ref
    && rule.thread === signal.thread && rule.from === signal.from && rule.domain === signal.domain
    && rule.textAll.every(part => signal.text.includes(part)));
}
export function localClock(now: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const field = (name: string) => parts.find(part => part.type === name)!.value;
  return { date: `${field("year")}-${field("month")}-${field("day")}`, time: `${field("hour")}:${field("minute")}` };
}
export function quiet(state: State, now: number) {
  const { quietStart: start, quietEnd: end, timezone } = state.settings, current = localClock(now, timezone).time;
  return start !== end && (start < end ? current >= start && current < end : current >= start || current < end);
}
export function deadlineBand(concern: Concern, now: number): Concern["escalation"] {
  if (!concern.dueAt) return "none";
  const left = Date.parse(concern.dueAt) - now;
  return left <= 6 * 3_600_000 ? "final" : left <= DAY ? "day-before" : left <= 3 * DAY ? "early" : "none";
}
const rank = { none: 0, early: 1, "day-before": 2, final: 3 };
export function advanceEscalation(concern: Concern, now: number) {
  const band = deadlineBand(concern, now);
  if (rank[band] > rank[concern.escalation]) concern.escalation = band;
}
/** A decaying, source+kind sample can defer low-priority evidence only until the daily review. */
export function deferToDaily(state: State, concern: Concern, input: { source: string; kind: string; now: number }): boolean {
  if (concern.priority !== "low" || concern.userExplicit || concern.dueAt) return false;
  const sample = state.feedback.filter(row => row.source === input.source && row.kind === input.kind && !row.dimensions.unavailable && input.now - Date.parse(row.at) <= 30 * DAY && input.now >= Date.parse(row.at));
  if (sample.length < state.settings.feedbackMinimum) return false;
  let negative = 0, total = 0;
  for (const row of sample) {
    const weight = 2 ** (-(input.now - Date.parse(row.at)) / (state.settings.feedbackHalfLifeDays * DAY));
    total += weight;
    if (row.dimensions.redundant && !row.dimensions.newEvidence && !row.dimensions.progress && !row.dimensions.userVisible) negative += weight;
  }
  return total >= state.settings.feedbackMinimum / 2 && negative / total >= 0.8;
}
export function runtimeView(state: State) {
  const current = state.decisions.find(row => row.id === state.runtime.currentDecisionId);
  const phase = current?.phase;
  return { ...state.runtime, phase: phase === "prepared" || phase === "running" || phase === "waiting" || phase === "unknown" ? phase : "idle" as const, runId: current?.runId ?? null, interactions: current?.interactions ?? [] };
}
export function stats(state: State, now: number) {
  return {
    open: state.concerns.filter(openConcern).length, pendingProposals: state.proposals.filter(item => item.status === "pending").length,
    unmatched: state.signals.filter(item => !item.associations.length && !item.dailyReviewedAt).length,
    wakes24h: state.decisions.filter(item => item.kind !== "manual" && now - Date.parse(item.at) < DAY).length,
    trustworthyReports: state.decisions.filter(item => item.phase === "completed").length,
  };
}
export type Selection = { kind: Decision["kind"]; concerns: Concern[]; signals: Signal[]; date: string; daily: boolean };
// eslint-disable-next-line complexity -- Evaluate the bounded deadline, revisit, expected-progress and waiting conditions together.
function concernReason(state: State, concern: Concern, now: number): Decision["kind"] | null {
  const band = deadlineBand(concern, now);
  if (rank[band] > rank[concern.escalation]) return "deadline";
  const checked = concern.lastCheckedAt ? Date.parse(concern.lastCheckedAt) : 0;
  if (concern.revisitAt && Date.parse(concern.revisitAt) <= now && checked < Date.parse(concern.revisitAt)) return "review";
  if (concern.expectedProgressAt && Date.parse(concern.expectedProgressAt) <= now && checked < Date.parse(concern.expectedProgressAt) && (!concern.progressAt || Date.parse(concern.progressAt) < Date.parse(concern.expectedProgressAt))) return "review";
  if ((concern.status === "waiting-external" || concern.status === "waiting-user") && now - (checked || Date.parse(concern.createdAt)) >= state.settings.waitingRecheckHours * 3_600_000) return "review";
  return null;
}
function retryBlocked(state: State, concern: Concern, signals: Signal[], now: number) {
  const last = state.decisions.findLast(d => d.revisions[concern.id] === concern.revision && d.concernIds.includes(concern.id));
  return !!last?.retryAt && Date.parse(last.retryAt) > now
    && !signals.some(s => s.associations.includes(concern.id) && matches(concern, s) && !s.reviewed.includes(concern.id)
      && !last.signalIds.includes(s.id) && Date.parse(s.receivedAt) > Date.parse(last.at));
}
// eslint-disable-next-line complexity -- Daily coalescing and focused selection share one quiet/snooze/feedback policy boundary.
export function selectWork(state: State, now: number, manual: boolean): Selection | null {
  const clock = localClock(now, state.settings.timezone);
  const lastDaily = state.decisions.findLast(d => d.kind === "daily");
  const daily = clock.time >= state.settings.dailyTime && (state.runtime.lastDailyDate !== clock.date
    || !!lastDaily?.retryAt && Date.parse(lastDaily.retryAt) <= now);
  const signals = state.signals.filter(signal => currentSignal(state, signal, now));
  const available = state.concerns.filter(openConcern).filter(c => manual || ((!c.silentUntil || Date.parse(c.silentUntil) <= now) && !retryBlocked(state, c, signals, now)));
  if (manual || daily && !quiet(state, now)) {
    const ordered = available.sort((a, b) => (Date.parse(a.lastCheckedAt ?? a.createdAt) - Date.parse(b.lastCheckedAt ?? b.createdAt)));
    const concerns = ordered.slice(0, 20);
    const selected = signals.filter(signal => !signal.dailyReviewedAt || signal.associations.some(cid => concerns.some(c => c.id === cid) && !signal.reviewed.includes(cid))).slice(0, 40);
    if (!concerns.length && !selected.length && !state.proposals.some(p => p.status === "pending")) return null;
    return { kind: manual ? "manual" : "daily", concerns, signals: selected, date: clock.date, daily: true };
  }
  const focused: Concern[] = [];
  let kind: Decision["kind"] = "signal";
  for (const concern of available) {
    const reason = concernReason(state, concern, now);
    const evidence = signals.filter(s => s.associations.includes(concern.id) && matches(concern, s) && !s.reviewed.includes(concern.id));
    const meaningful = evidence.some(s => !deferToDaily(state, concern, { source: s.moduleId, kind: s.kind, now }));
    if (!reason && !meaningful) continue;
    if (quiet(state, now) && concern.priority !== "critical" && reason !== "deadline") continue;
    focused.push(concern);
    if (reason) kind = reason;
  }
  if (!focused.length) return null;
  const concerns = focused.sort((a, b) => Number(b.priority === "critical") - Number(a.priority === "critical") || Date.parse(a.dueAt ?? "9999-01-01") - Date.parse(b.dueAt ?? "9999-01-01")).slice(0, 20);
  return { kind, concerns, signals: signals.filter(s => s.associations.some(cid => concerns.some(c => c.id === cid) && !s.reviewed.includes(cid))).slice(0, 40), date: clock.date, daily: false };
}

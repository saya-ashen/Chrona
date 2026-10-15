import type { Affair, AffairDetail, Ask, Entry, EntryKind } from "@chrona/contracts";
import { formatCadence } from "./format";

export const groupOrder = ["waiting", "active", "watching", "paused", "done"] as const;
export function groupAffairs(affairs: Affair[]) {
  return groupOrder.map(key => ({ key, items: affairs.filter(a => (a.openAsks > 0 ? "waiting" : a.status) === key).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.id.localeCompare(b.id)) }));
}
export function affairState(a: Affair, asks?: Ask[]) {
  if (a.openAsks > 0) {
    if (asks?.some(ask => ask.status === "open" && ask.kind === "question")) return "answer";
    if (asks?.some(ask => ask.status === "open" && ask.kind === "approval")) return "approval";
    return "waiting";
  }
  if (a.status === "paused" || a.status === "done") return a.status;
  if (a.agentState === "failed" || a.agentState === "running" || a.agentState === "queued") return a.agentState;
  if (a.agentState === "waiting_user") return "waiting";
  return a.status;
}
export function stateLabel(a: Affair, labels: Record<ReturnType<typeof affairState>, string> & { cadence: string }, locale: string, asks?: Ask[]) {
  const state = affairState(a, asks);
  return state === "watching" && a.care ? formatCadence(a.care.cadenceSeconds, labels.cadence, locale) : labels[state];
}
export function timeline(entries: Entry[]) { return [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)); }
export function timelineLabel(entry: Entry, labels: { you: string; source: string; kinds: Record<EntryKind, string> }) {
  return entry.actor === "user" ? labels.you : entry.actor === "source" ? labels.source : `Chrona · ${labels.kinds[entry.kind]}`;
}
export function parseCare(minutes: string, notify: string) {
  const value = Number(minutes);
  if (!minutes.trim() || !Number.isInteger(value) || value < 5 || value > 10080 || !["now", "digest", "web"].includes(notify)) return null;
  return { cadenceSeconds: value * 60, notify: notify as "now" | "digest" | "web" };
}
export function detailView(detail: AffairDetail) {
  return { ...detail, entries: timeline(detail.entries), asks: detail.asks.filter(a => a.status === "open"), grants: detail.grants.filter(g => g.scope.kind === "affair" && g.scope.affairId === detail.affair.id && !g.revokedAt), toolCalls: detail.runs.reduce((n, r) => n + r.toolCalls.length, 0) };
}
export function safeSourceUrl(url: string) { try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? url : undefined; } catch { return undefined; } }
export function resultVersion(value: string | undefined) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; }

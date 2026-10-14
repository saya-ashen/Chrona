import { ATTENTION_DECISIONS, type AttentionItem, type AttentionKind, type StewardHealth, type TodayView } from "@chrona/contracts";

export const TODAY_SECTIONS = ["decisions", "changes", "commitments", "suggestions", "results"] as const;
export type AttentionDecision = (typeof ATTENTION_DECISIONS)[number];
const decisionsByKind: Record<AttentionKind, readonly AttentionDecision[]> = {
  decision: ["approve", "decline", "snooze"], suggestion: ["approve", "dismiss", "less_often", "snooze"],
  commitment: ["done", "snooze"], change: ["dismiss", "done"], result: ["dismiss", "done"], failure: ["dismiss", "done"],
};
export function attentionDecisions(item: Pick<AttentionItem, "kind" | "status">) {
  return item.status === "open" ? decisionsByKind[item.kind] : [];
}
export function decisionInput(decision: AttentionDecision, now: Date) {
  return { decision, ...(decision === "snooze" ? { snoozeUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() } : {}) };
}
export function healthIssues(health: StewardHealth) {
  return [
    ...(!health.assessor.available ? [{ kind: "assessor" as const, count: null, since: null }] : []),
    ...(health.pendingEvents > 0 ? [{ kind: "pendingEvents" as const, count: health.pendingEvents, since: health.oldestPendingAt }] : []),
    ...(["failedEvents", "failedNotifications", "failingConnections"] as const).flatMap(kind => health[kind] > 0 ? [{ kind, count: health[kind], since: null }] : []),
  ];
}
export function deriveToday(view: TodayView) {
  const sections = TODAY_SECTIONS.map(key => ({ key, items: view[key], recentResults: key === "results" ? view.recentResults : [] }));
  const issues = healthIssues(view.health);
  const empty = sections.every(section => section.items.length === 0 && section.recentResults.length === 0);
  return { sections, issues, empty, allClear: empty && issues.length === 0 };
}
/** Evidence URLs are untrusted. Never make javascript/data URLs navigable. */
export function evidenceHref(url?: string): string | undefined {
  if (!url) return undefined;
  try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}

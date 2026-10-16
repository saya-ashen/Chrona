import type { Affair, Health, ScheduleRule } from "@chrona/contracts";

export function groupWorkspaceAffairs(affairs: Affair[]) {
  return (["waiting", "active", "paused", "done"] as const).map(key => ({ key, items: affairs.filter(affair => key === "waiting" ? affair.openApprovals > 0 : affair.openApprovals === 0 && affair.status === key).sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) || a.id.localeCompare(b.id)) }));
}
export function scheduleDescription(rule: ScheduleRule, locale: string, copy: { daily: string; weekly: string; every: string }) {
  switch (rule.kind) {
    case "at": return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(rule.at));
    case "daily": return copy.daily.replace("{time}", rule.time);
    case "every": return copy.every.replace("{minutes}", String(rule.minutes));
    case "weekly": return copy.weekly.replace("{time}", rule.time).replace("{days}", rule.days.map(day => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day)))).join("、"));
  }
}
export function workspaceHealthy(health: Health) {
  return health.provider.available && health.git && !health.provider.lastError && health.failedRunsToday === 0 && health.failingConnectors === 0 && health.failedNotifications === 0;
}
export function pageHref(locale: string, affairId: string, path?: string) {
  return `/${locale}/affairs/${encodeURIComponent(affairId)}${path ? `?${new URLSearchParams({ path })}` : ""}`;
}

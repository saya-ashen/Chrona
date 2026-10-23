import type { App, Health, ScheduleRule } from "@chrona/contracts";

export function groupWorkspaceApps(apps: App[]) {
  return (["active", "paused"] as const).map(key => ({ key, items: apps.filter(app => app.status === key).sort((a, b) => a.name.localeCompare(b.name)) }));
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
  return health.provider.available && health.moduleSandbox && !health.provider.lastError && health.failedRunsToday === 0 && health.failingConnectors === 0 && health.failedNotifications === 0;
}
export function pageHref(locale: string, appId: string, path?: string) {
  return `/${locale}/apps/${encodeURIComponent(appId)}${path ? `?${new URLSearchParams({ path })}` : ""}`;
}

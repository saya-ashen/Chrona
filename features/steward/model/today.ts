import type { TodayView } from "@chrona/contracts";
export const todaySections = ["decisions", "changes", "results", "upcoming", "suggestions"] as const;
export function visibleSections(view: TodayView) { return todaySections.filter(key => view[key].length > 0); }
export function headline(counts: TodayView["counts"], copy: { waiting: string; clear: string }) {
  return counts.waiting > 0 ? copy.waiting.replace("{count}", String(counts.waiting)) : copy.clear;
}
export function summary(counts: TodayView["counts"], template: string) {
  return template.replace("{active}", String(counts.active)).replace("{watching}", String(counts.watching)).replace("{results}", String(counts.newResults));
}
export function healthProblems(view: TodayView) {
  return [!view.health.agent.available ? "agentUnavailable" : null, view.health.failingConnections > 0 ? "sourceFailing" : null, view.health.failedNotifications > 0 ? "notificationFailed" : null].filter((key): key is "agentUnavailable" | "sourceFailing" | "notificationFailed" => key !== null);
}
export function relativeTime(at: string, now: string, locale: string) {
  const seconds = (Date.parse(at) - Date.parse(now)) / 1000;
  const [unit, divisor] = Math.abs(seconds) < 3600 ? ["minute", 60] as const : Math.abs(seconds) < 86400 ? ["hour", 3600] as const : ["day", 86400] as const;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(seconds / divisor), unit);
}

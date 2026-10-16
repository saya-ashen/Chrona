import type { NotifyLevel } from "@chrona/contracts";
export function formatTime(at: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}
/** Short date-time for timelines and schedules: "10/17 09:00" style, year only when not this year. */
export function formatShortDateTime(at: string, locale: string, now = new Date()) {
  const date = new Date(at);
  return new Intl.DateTimeFormat(locale, { ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }), month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
export function formatCadence(seconds: number, template: string, locale: string) {
  const unit = seconds % 86400 === 0 ? "day" : seconds % 3600 === 0 ? "hour" : "minute";
  const divisor = unit === "day" ? 86400 : unit === "hour" ? 3600 : 60;
  return template.replace("{duration}", new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(seconds / divisor));
}
export function formatNotifyLevel(level: NotifyLevel, labels: Record<NotifyLevel, string>) { return labels[level]; }

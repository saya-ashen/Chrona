import type { NotificationSettings, NotifyLevel } from "@chrona/contracts/steward";

function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
export function localDayKey(now: Date, timezone: string): string { return localParts(now, timezone).day; }
export function routeNotification(level: NotifyLevel, ctx: Pick<NotificationSettings, "dailyCap" | "quietHours" | "timezone"> & {
  sentToday: number; now: Date; urgent: boolean;
}): "send" | "fold" | "web" {
  if (level === "web") return "web";
  if (level === "digest" || ctx.sentToday >= ctx.dailyCap) return "fold";
  if (ctx.quietHours && !ctx.urgent) {
    const { start, end } = ctx.quietHours;
    const { time } = localParts(ctx.now, ctx.timezone);
    const quiet = start > end ? time >= start || time < end : time >= start && time < end;
    if (quiet) return "fold";
  }
  return "send";
}
export function isDigestDue(ctx: { digestAt: string; timezone: string; now: Date; lastDigestDay: string | null }): boolean {
  const { day, time } = localParts(ctx.now, ctx.timezone);
  return day !== ctx.lastDigestDay && time >= ctx.digestAt;
}

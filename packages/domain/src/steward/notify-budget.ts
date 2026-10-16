import type { NotificationSettings, NotifyLevel } from "@chrona/contracts/steward";

function localParts(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
/** Notifications answering the user's own request are keyed with this prefix and never use the proactive budget. */
export const RESPONSE_KEY_PREFIX = "response:";
export function localDayKey(now: Date, timezone: string): string { return localParts(now, timezone).day; }
export function routeNotification(level: NotifyLevel, ctx: Pick<NotificationSettings, "dailyCap" | "quietHours" | "timezone"> & {
  sentToday: number; now: Date; urgent: boolean;
  /** The user is waiting for this (it answers something they asked): not an interruption, so no cap or quiet hours. */
  responds?: boolean;
}): "send" | "fold" | "web" {
  if (level === "web") return "web";
  if (ctx.responds) return "send";
  if (level === "digest" || ctx.sentToday >= ctx.dailyCap) return "fold";
  if (ctx.quietHours && !ctx.urgent) {
    const { start, end } = ctx.quietHours;
    const { time } = localParts(ctx.now, ctx.timezone);
    const quiet = start > end ? time >= start || time < end : time >= start && time < end;
    if (quiet) return "fold";
  }
  return "send";
}
/** A digest covers what was folded before its own send time; later folds wait for the next day's digest. */
export function foldedBeforeDigest(foldedAt: Date, ctx: { digestAt: string; timezone: string; now: Date }): boolean {
  const folded = localParts(foldedAt, ctx.timezone), today = localParts(ctx.now, ctx.timezone);
  return folded.day < today.day || (folded.day === today.day && folded.time < ctx.digestAt);
}
export function isDigestDue(ctx: { digestAt: string; timezone: string; now: Date; lastDigestDay: string | null }): boolean {
  const { day, time } = localParts(ctx.now, ctx.timezone);
  return day !== ctx.lastDigestDay && time >= ctx.digestAt;
}

// The notification budget: pure rules, no I/O. Built-in modules run standalone, so these live with the module.
export type Level = "now" | "digest" | "web";
export type Settings = { dailyCap: number; quietHours: { start: string; end: string } | null; timezone: string; digestAt: string };
export const DEFAULT_SETTINGS: Settings = { dailyCap: 5, quietHours: { start: "23:00", end: "08:00" }, timezone: "Asia/Shanghai", digestAt: "09:00" };

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
export function routeNotification(level: Level, ctx: Pick<Settings, "dailyCap" | "quietHours" | "timezone"> & {
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
export function composeDigest(items: readonly { moduleTitle: string | null; title: string; body: string }[], { dayLabel }: { dayLabel: string }): { title: string; body: string } | null {
  if (!items.length) return null;
  const groups = new Map<string | null, typeof items[number][]>();
  for (const item of items.slice(0, 10)) {
    const group = groups.get(item.moduleTitle) ?? [];
    group.push(item);
    groups.set(item.moduleTitle, group);
  }
  const sections = [...groups].map(([title, group]) => `${title ?? "其他动态"}\n${group.map((item) => {
    const [first, ...rest] = item.body.trim().split(/\r?\n/);
    const body = first.trim() === item.title.trim() ? rest.join("\n").trim() : item.body;
    return `- ${item.title}：${body}`;
  }).join("\n")}`);
  if (items.length > 10) sections.push(`另有 ${items.length - 10} 条`);
  return { title: `${dayLabel}日报`, body: sections.join("\n\n") };
}
/** Delivery outcome → stored status. Unknown outcomes are never resent automatically. */
export type DeliveryOutcome = { outcome: "accepted"; receiptRef: string | null } | { outcome: "rejected"; retryable: boolean; error: string } | { outcome: "uncertain"; error: string };
export function deliveryStatus(outcome: DeliveryOutcome, attempts: number) {
  return outcome.outcome === "accepted" ? "sent" : outcome.outcome === "uncertain" ? "uncertain" : outcome.retryable && attempts < 6 ? "queued" : "failed";
}
export const retryDelayMs = (attempts: number) => Math.min(21_600_000, 60_000 * 2 ** (attempts - 1));
export function validSettings(value: Settings) {
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(new Date()); } catch { return false; }
  const time = (text: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
  return Number.isInteger(value.dailyCap) && value.dailyCap >= 0 && value.dailyCap <= 50 && time(value.digestAt) && (!value.quietHours || (time(value.quietHours.start) && time(value.quietHours.end)));
}

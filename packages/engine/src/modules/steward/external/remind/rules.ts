import { z } from "zod";
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const scheduleRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string().datetime({ offset: true }) }).strict(),
  z.object({ kind: z.literal("daily"), time }).strict(),
  z.object({ kind: z.literal("weekly"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), time }).strict(),
  z.object({ kind: z.literal("every"), minutes: z.number().int().min(5).max(10080) }).strict(),
]);
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

/** Strictly after `after`. Missing DST wall times are skipped; repeated wall times
 * are both occurrences. `every` is elapsed time, independent of wall-clock changes. */
export function nextOccurrence(rule: ScheduleRule, after: Date, timezone: string): Date | null {
  if (!Number.isFinite(after.getTime())) throw new Error("无效日期");
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (rule.kind === "at") return Date.parse(rule.at) > after.getTime() ? new Date(rule.at) : null;
  if (rule.kind === "every") return new Date(after.getTime() + rule.minutes * 60_000);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // Two weeks include the next weekly occurrence even when this week's wall time
  // disappears at a timezone transition (including a skipped calendar day).
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let at = start; at < start + 15 * 86400_000; at += 60_000) {
    const parts = formatter.formatToParts(at);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
    if (`${part("hour")}:${part("minute")}` === rule.time && (rule.kind === "daily" || rule.days.some(day => weekdays[day] === part("weekday")))) return new Date(at);
  }
  throw new Error("无法计算下次时间");
}

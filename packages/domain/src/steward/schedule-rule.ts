import { scheduleRuleSchema, type ScheduleRule } from "@chrona/contracts/steward";

function validate(rule: ScheduleRule): void {
  scheduleRuleSchema.parse(rule);
  if ((rule.kind === "daily" || rule.kind === "weekly") && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.time)) throw new Error("无效时间");
}

/** Strictly after `after`. Missing DST wall times are skipped; repeated wall times
 * are both occurrences. `every` is elapsed time, independent of wall-clock changes. */
export function nextOccurrence(rule: ScheduleRule, after: Date, timezone: string): Date | null {
  validate(rule);
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

export function describeRule(rule: ScheduleRule): string {
  validate(rule);
  switch (rule.kind) {
    case "daily": return `每天 ${rule.time}`;
    case "weekly": return `每周${[...new Set(rule.days)].sort((a, b) => (a || 7) - (b || 7)).map(day => ["日", "一", "二", "三", "四", "五", "六"][day]).join("、")} ${rule.time}`;
    case "every": return `每 ${rule.minutes} 分钟`;
    // Preserve the wall time explicitly supplied in the ISO value, not the host timezone.
    case "at": return `${Number(rule.at.slice(5, 7))}月${Number(rule.at.slice(8, 10))}日 ${rule.at.slice(11, 16)}`;
  }
}

import { type ScheduleItem } from "@chrona/contracts";

/** Fourteen local calendar days, including today; end is exclusive. */
export function stewardScheduleRange(now: Date) {
  const from = new Date(now); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 14);
  return { from: from.toISOString(), to: to.toISOString() };
}
export function localDayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function scheduleNeedsConfirmation(item: ScheduleItem) { return item.kind === "unconfirmed_suggestion" || !item.confirmed; }
export function groupScheduleDays(items: ScheduleItem[]) {
  const days = new Map<string, ScheduleItem[]>();
  for (const item of [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const day = localDayKey(new Date(item.startsAt));
    const group = days.get(day) ?? []; group.push(item); days.set(day, group);
  }
  return [...days].map(([day, items]) => ({ day, items }));
}

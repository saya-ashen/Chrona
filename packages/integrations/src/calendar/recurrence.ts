import ICAL from "ical.js";

export type RecurrenceOccurrence = {
  startsAt: Date;
  endsAt: Date;
};

export type ExpandRecurrenceRuleOptions = {
  from: Date;
  to: Date;
  maxOccurrences?: number;
};

const DEFAULT_MAX_OCCURRENCES = 500;

function buildRecurringComponent(rrule: string, dtStart: Date): ICAL.Event {
  const vevent = new ICAL.Component("vevent");
  const event = new ICAL.Event(vevent);
  event.uid = "chrona-series";
  event.startDate = ICAL.Time.fromJSDate(dtStart, true);
  vevent.addPropertyWithValue("rrule", ICAL.Recur.fromString(rrule));
  return event;
}

/**
 * Expand a raw RRULE string + start date into concrete occurrences within a
 * bounded forward window. Used to materialize WorkBlocks for Chrona-native
 * recurring tasks (which only store an RRULE + first start, not a parsed feed).
 */
export function expandRecurrenceRule(
  rrule: string,
  dtStart: Date,
  durationMs: number,
  options: ExpandRecurrenceRuleOptions,
): RecurrenceOccurrence[] {
  if (Number.isNaN(dtStart.getTime()) || durationMs <= 0) return [];

  const maxOccurrences = options.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;
  let event: ICAL.Event;
  try {
    event = buildRecurringComponent(rrule, dtStart);
  } catch {
    throw new Error("invalid_recurrence_rule");
  }

  const iterator = event.iterator();
  const occurrences: RecurrenceOccurrence[] = [];
  let scanned = 0;

  for (;;) {
    const next = iterator.next() as ICAL.Time | null;
    if (!next) break;

    const startsAt = next.toJSDate();
    scanned += 1;
    if (Number.isNaN(startsAt.getTime())) continue;
    if (startsAt >= options.to) break;

    const endsAt = new Date(startsAt.getTime() + durationMs);
    if (startsAt < options.to && endsAt > options.from) {
      occurrences.push({ startsAt, endsAt });
    }

    if (occurrences.length >= maxOccurrences || scanned >= maxOccurrences * 20) break;
  }

  return occurrences;
}

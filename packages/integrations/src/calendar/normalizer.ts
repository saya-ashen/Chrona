import ICAL from "ical.js";
import type { CalendarEventStatus } from "@chrona/contracts";

export type NormalizedCalendarEvent = {
  externalUid: string;
  recurrenceId?: string | null;
  recurrenceRule: string | null;
  dedupeKey: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  status: CalendarEventStatus;
};

export type ParseCalendarResult = {
  name?: string;
  events: NormalizedCalendarEvent[];
  skippedCount: number;
};

type ParseCalendarRange = {
  from: Date;
  to: Date;
  maxOccurrences?: number;
};

type CollectedCalendarEvents = {
  exceptions: ICAL.Event[];
  masterEvents: Map<string, ICAL.Event[]>;
  skippedCount: number;
};

const DEFAULT_RECURRING_WINDOW_DAYS = 90;
const DEFAULT_MAX_RECURRING_OCCURRENCES = 500;

function toDate(value: ICAL.Time) {
  return value.toJSDate();
}

function eventStatus(event: ICAL.Event): CalendarEventStatus {
  const status = event.component.getFirstPropertyValue("status");
  if (String(status).toUpperCase() === "CANCELLED") return "cancelled";
  if (String(status).toUpperCase() === "TENTATIVE") return "tentative";
  return "confirmed";
}

function eventDescription(event: ICAL.Event) {
  return event.component.getFirstPropertyValue("description")?.toString() ?? null;
}

function eventDedupeKey(event: ICAL.Event, recurrenceId: string | null, startsAt: Date) {
  return [event.uid, recurrenceId ?? "single", startsAt.toISOString()].join(":");
}

function recurrenceIdFrom(event: ICAL.Event) {
  const recurrenceId = event.recurrenceId as ICAL.Time | null | undefined;
  return recurrenceId ? recurrenceId.toString() : null;
}

function recurrenceRuleFrom(event: ICAL.Event): string | null {
  const rrule = event.component.getFirstPropertyValue("rrule");
  return rrule ? rrule.toString() : null;
}

function toNormalizedEvent(
  event: ICAL.Event,
  startsAt: Date,
  endsAt: Date,
  recurrenceId: string | null,
  recurrenceRule: string | null,
): NormalizedCalendarEvent {
  return {
    externalUid: event.uid,
    recurrenceId,
    recurrenceRule,
    dedupeKey: eventDedupeKey(event, recurrenceId, startsAt),
    title: event.summary || "Untitled external event",
    description: eventDescription(event),
    startsAt,
    endsAt,
    isAllDay: event.startDate.isDate,
    status: eventStatus(event),
  };
}

function overlapsRange(startsAt: Date, endsAt: Date, range: ParseCalendarRange) {
  return startsAt < range.to && endsAt > range.from;
}

function recurringRangeFor(event: ICAL.Event, range?: ParseCalendarRange): ParseCalendarRange {
  if (range) return range;

  const from = toDate(event.startDate);
  const to = new Date(from.getTime() + DEFAULT_RECURRING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}

function expandRecurringEvent(event: ICAL.Event, range?: ParseCalendarRange) {
  const effectiveRange = recurringRangeFor(event, range);
  const maxOccurrences = effectiveRange.maxOccurrences ?? DEFAULT_MAX_RECURRING_OCCURRENCES;
  const recurrenceRule = recurrenceRuleFrom(event);
  const iterator = event.iterator();
  const events: NormalizedCalendarEvent[] = [];
  let scanned = 0;

  for (;;) {
    const occurrence = iterator.next() as ICAL.Time | null;
    if (!occurrence) break;

    const details = event.getOccurrenceDetails(occurrence);
    const startsAt = toDate(details.startDate);
    const endsAt = toDate(details.endDate);
    scanned += 1;

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) continue;
    if (startsAt >= effectiveRange.to) break;

    if (overlapsRange(startsAt, endsAt, effectiveRange)) {
      const occurrenceEvent = details.item;
      const recurrenceId = occurrence.toString();
      events.push(toNormalizedEvent(occurrenceEvent, startsAt, endsAt, recurrenceId, recurrenceRule));
    }

    if (events.length >= maxOccurrences || scanned >= maxOccurrences * 20) break;
  }

  return events;
}

function validEventRange(event: ICAL.Event) {
  const startsAt = toDate(event.startDate);
  const endsAt = toDate(event.endDate);
  if (!event.uid || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  return { startsAt, endsAt };
}

function collectCalendarEvents(component: ICAL.Component): CollectedCalendarEvents {
  const exceptions: ICAL.Event[] = [];
  const masterEvents = new Map<string, ICAL.Event[]>();
  let skippedCount = 0;

  for (const vevent of component.getAllSubcomponents("vevent")) {
    try {
      const event = new ICAL.Event(vevent);
      if (!validEventRange(event)) {
        skippedCount += 1;
        continue;
      }

      if (event.isRecurrenceException()) {
        exceptions.push(event);
        continue;
      }

      const eventMasters = masterEvents.get(event.uid) ?? [];
      eventMasters.push(event);
      masterEvents.set(event.uid, eventMasters);
    } catch {
      skippedCount += 1;
    }
  }

  return { exceptions, masterEvents, skippedCount };
}

function normalizeDetachedException(exception: ICAL.Event, range?: ParseCalendarRange) {
  const eventRange = validEventRange(exception);
  if (!eventRange) return null;
  if (range && !overlapsRange(eventRange.startsAt, eventRange.endsAt, range)) return null;

  return toNormalizedEvent(exception, eventRange.startsAt, eventRange.endsAt, recurrenceIdFrom(exception), recurrenceRuleFrom(exception));
}

function normalizeMasterEvent(event: ICAL.Event, range?: ParseCalendarRange) {
  if (event.isRecurring()) return expandRecurringEvent(event, range);

  const eventRange = validEventRange(event);
  if (!eventRange) return [];
  if (range && !overlapsRange(eventRange.startsAt, eventRange.endsAt, range)) return [];

  return [toNormalizedEvent(event, eventRange.startsAt, eventRange.endsAt, recurrenceIdFrom(event), null)];
}

function normalizeCollectedEvents(collected: CollectedCalendarEvents, range?: ParseCalendarRange) {
  const events: NormalizedCalendarEvent[] = [];

  for (const exception of collected.exceptions) {
    const relatedMaster = collected.masterEvents.get(exception.uid)?.find((event) => event.isRecurring());
    if (relatedMaster) {
      relatedMaster.relateException(exception);
    } else {
      const detachedException = normalizeDetachedException(exception, range);
      if (detachedException) events.push(detachedException);
    }
  }

  for (const eventMasters of collected.masterEvents.values()) {
    for (const event of eventMasters) events.push(...normalizeMasterEvent(event, range));
  }

  return events;
}

export function parseICalendarFeed(feed: string, range?: ParseCalendarRange): ParseCalendarResult {
  try {
    const jcal = ICAL.parse(feed);
    const component = new ICAL.Component(jcal);
    const name = component.getFirstPropertyValue("x-wr-calname")?.toString();
    const collected = collectCalendarEvents(component);

    return {
      name,
      events: normalizeCollectedEvents(collected, range),
      skippedCount: collected.skippedCount,
    };
  } catch {
    throw new Error("malformed_calendar");
  }
}

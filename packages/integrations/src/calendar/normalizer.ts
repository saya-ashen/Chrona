import ICAL from "ical.js";
import type { CalendarEventStatus } from "@chrona/contracts";

export type NormalizedCalendarEvent = {
  externalUid: string;
  recurrenceId?: string | null;
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

function toDate(value: ICAL.Time) {
  return value.toJSDate();
}

function eventStatus(event: ICAL.Event): CalendarEventStatus {
  const status = event.component.getFirstPropertyValue("status");
  if (String(status).toUpperCase() === "CANCELLED") return "cancelled";
  if (String(status).toUpperCase() === "TENTATIVE") return "tentative";
  return "confirmed";
}

export function parseICalendarFeed(feed: string, range?: { from: Date; to: Date }): ParseCalendarResult {
  try {
    const jcal = ICAL.parse(feed);
    const component = new ICAL.Component(jcal);
    const name = component.getFirstPropertyValue("x-wr-calname")?.toString();
    const events: NormalizedCalendarEvent[] = [];
    let skippedCount = 0;

    for (const vevent of component.getAllSubcomponents("vevent")) {
      try {
        const event = new ICAL.Event(vevent);
        const startsAt = toDate(event.startDate);
        const endsAt = toDate(event.endDate);
        if (!event.uid || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
          skippedCount += 1;
          continue;
        }

        if (range && (startsAt >= range.to || endsAt <= range.from)) continue;

        const recurrenceId = event.recurrenceId?.toString() ?? null;
        const dedupeKey = [event.uid, recurrenceId ?? "single", startsAt.toISOString()].join(":");
        events.push({
          externalUid: event.uid,
          recurrenceId,
          dedupeKey,
          title: event.summary || "Untitled external event",
          description: vevent.getFirstPropertyValue("description")?.toString() ?? null,
          startsAt,
          endsAt,
          isAllDay: event.startDate.isDate,
          status: eventStatus(event),
        });
      } catch {
        skippedCount += 1;
      }
    }

    return { name, events, skippedCount };
  } catch {
    throw new Error("malformed_calendar");
  }
}

import type { ImportedCalendarEventSummary } from "@chrona/contracts";

export type ScheduledPlanningBlock = {
  id: string;
  startsAt: Date;
  endsAt: Date;
};

export type PlanningBusyBlock = {
  id: string;
  calendarSourceId: string;
  sourceName: string;
  sourceColor: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  readOnly: true;
  overlapsScheduledTask: boolean;
};

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

export function projectPlanningBusyBlocks({
  events,
  scheduledBlocks = [],
}: {
  events: ImportedCalendarEventSummary[];
  scheduledBlocks?: ScheduledPlanningBlock[];
}): PlanningBusyBlock[] {
  return events
    .filter((event) => event.status !== "cancelled")
    .map((event) => {
      const startsAt = new Date(event.startsAt);
      const endsAt = new Date(event.endsAt);
      return {
        id: event.id,
        calendarSourceId: event.calendarSourceId,
        sourceName: event.sourceName,
        sourceColor: event.sourceColor,
        title: event.title,
        startsAt,
        endsAt,
        isAllDay: event.isAllDay,
        readOnly: true,
        overlapsScheduledTask: scheduledBlocks.some((block) =>
          overlaps(startsAt, endsAt, block.startsAt, block.endsAt),
        ),
      } satisfies PlanningBusyBlock;
    });
}

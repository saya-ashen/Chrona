import { describe, expect, it } from "bun:test";

import { projectPlanningBusyBlocks } from "./planning-busy-blocks";

describe("projectPlanningBusyBlocks", () => {
  it("projects read-only imported events and marks overlaps with scheduled tasks", () => {
    const blocks = projectPlanningBusyBlocks({
      events: [
        {
          id: "event-1",
          calendarSourceId: "source-1",
          sourceName: "Team Calendar",
          sourceColor: "#0f766e",
          title: "Design review",
          startsAt: "2026-04-15T09:30:00.000Z",
          endsAt: "2026-04-15T10:00:00.000Z",
          isAllDay: false,
          status: "confirmed",
          readOnly: true,
        },
        {
          id: "event-2",
          calendarSourceId: "source-1",
          sourceName: "Team Calendar",
          sourceColor: "#0f766e",
          title: "Lunch",
          startsAt: "2026-04-15T12:00:00.000Z",
          endsAt: "2026-04-15T13:00:00.000Z",
          isAllDay: false,
          status: "tentative",
          readOnly: true,
        },
      ],
      scheduledBlocks: [
        {
          id: "task-1",
          startsAt: new Date("2026-04-15T09:00:00.000Z"),
          endsAt: new Date("2026-04-15T10:30:00.000Z"),
        },
      ],
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      title: "Design review",
      sourceName: "Team Calendar",
      sourceColor: "#0f766e",
      readOnly: true,
      overlapsScheduledTask: true,
    });
    expect(blocks[1]?.overlapsScheduledTask).toBe(false);
  });

  it("excludes cancelled imported events from planning busy blocks", () => {
    const blocks = projectPlanningBusyBlocks({
      events: [
        {
          id: "event-1",
          calendarSourceId: "source-1",
          sourceName: "Team Calendar",
          sourceColor: "#0f766e",
          title: "Cancelled hold",
          startsAt: "2026-04-15T09:00:00.000Z",
          endsAt: "2026-04-15T10:00:00.000Z",
          isAllDay: false,
          status: "cancelled",
          readOnly: true,
        },
      ],
    });

    expect(blocks).toEqual([]);
  });
});

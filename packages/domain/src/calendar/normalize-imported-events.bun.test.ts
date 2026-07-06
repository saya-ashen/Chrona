import { describe, expect, it } from "bun:test";
import { normalizeImportedEvents } from "./normalize-imported-events";

describe("normalizeImportedEvents", () => {
  it("deduplicates by UID, recurrence, and start time", () => {
    const startsAt = new Date("2030-01-01T10:00:00.000Z");
    const endsAt = new Date("2030-01-01T11:00:00.000Z");

    const events = normalizeImportedEvents([
      { externalUid: "uid-1", recurrenceId: null, title: " Standup ", startsAt, endsAt },
      { externalUid: "uid-1", recurrenceId: null, title: "Duplicate", startsAt, endsAt },
      { externalUid: "uid-1", recurrenceId: "20300102T100000Z", title: "Next day", startsAt: new Date("2030-01-02T10:00:00.000Z"), endsAt: new Date("2030-01-02T11:00:00.000Z") },
    ]);

    expect(events.map((event) => event.title)).toEqual(["Standup", "Next day"]);
    expect(events.map((event) => event.dedupeKey)).toEqual([
      "uid-1:single:2030-01-01T10:00:00.000Z",
      "uid-1:20300102T100000Z:2030-01-02T10:00:00.000Z",
    ]);
  });

  it("normalizes empty optional fields without losing status or all-day state", () => {
    const [event] = normalizeImportedEvents([
      {
        externalUid: "uid-2",
        title: "   ",
        description: "  ",
        startsAt: new Date("2030-02-01T00:00:00.000Z"),
        endsAt: new Date("2030-02-02T00:00:00.000Z"),
        isAllDay: true,
        status: "cancelled",
      },
    ]);

    expect(event).toMatchObject({
      title: "Untitled external event",
      description: null,
      recurrenceId: null,
      recurrenceRule: null,
      isAllDay: true,
      status: "cancelled",
    });
  });
});

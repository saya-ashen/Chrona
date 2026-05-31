import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";

import { resetTestDb, seedWorkspace } from "../__tests__/bun-test-helpers";
import { createExternalCalendarService } from "./external-calendar-service";

const googleFeed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chrona//Google Policy Fixture//EN
BEGIN:VEVENT
UID:google-past-event@example.test
DTSTAMP:20260501T080000Z
DTSTART:20260501T090000Z
DTEND:20260501T100000Z
SUMMARY:Past Google sync
END:VEVENT
END:VCALENDAR`;

describe("External calendar service sync policies", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("defaults Google calendar subscriptions to completing past events", async () => {
    const { workspaceId } = await seedWorkspace("Google policy");
    const service = createExternalCalendarService({
      now: () => new Date("2026-05-30T10:00:00.000Z"),
      transport: async () => ({ status: 200, text: googleFeed }),
    });

    const result = await service.createSource(workspaceId, {
      name: "Google calendar",
      url: "https://calendar.google.com/calendar/ical/user/basic.ics",
      color: "#2563eb",
    });

    expect("source" in result ? result.source.syncPolicy : null).toBe("auto_complete_past_events");
    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId },
      include: { task: { include: { projection: true } } },
    });
    expect(importedEvent.task?.status).toBe("Completed");
    expect(importedEvent.task?.projection?.scheduledStartAt).toBeNull();
  });
});

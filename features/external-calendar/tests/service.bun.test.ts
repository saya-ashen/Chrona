import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";

import { resetTestDb, seedWorkspace } from "@server/__tests__/bun-test-helpers";
import { createExternalCalendarService } from "..";

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
    expect("source" in result ? result.source.automationPolicy : null).toBe("auto_plan");
    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId },
      include: { task: { include: { projection: true } } },
    });
    expect(importedEvent.task?.status).toBe("Completed");
    expect(importedEvent.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  it("starts plan generation for new future confirmed imports", async () => {
    const { workspaceId } = await seedWorkspace("Google automation");
    const startedPlans: Array<{ taskId: string; workBlockId?: string | null; accept?: boolean }> = [];
    const futureFeed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chrona//Future Policy Fixture//EN
BEGIN:VEVENT
UID:google-future-event@example.test
DTSTAMP:20260501T080000Z
DTSTART:20260601T090000Z
DTEND:20260601T100000Z
SUMMARY:Future Google sync
END:VEVENT
END:VCALENDAR`;
    const service = createExternalCalendarService({
      now: () => new Date("2026-05-30T10:00:00.000Z"),
      transport: async () => ({ status: 200, text: futureFeed }),
      autoPlanTask: (input) => {
        startedPlans.push(input);
      },
    });

    const result = await service.createSource(workspaceId, {
      name: "Google calendar",
      url: "https://calendar.google.com/calendar/ical/user/basic.ics",
      color: "#2563eb",
      automationPolicy: "auto_execute",
    });

    expect("source" in result ? result.source.automationPolicy : null).toBe("auto_execute");
    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId },
      include: { task: true, workBlock: true },
    });
    expect(importedEvent.task?.autoPlanGeneration).toBe(true);
    expect(importedEvent.task?.autoExecute).toBe(true);
    const taskId = importedEvent.task?.id;
    const workBlockId = importedEvent.workBlock?.id;
    if (!taskId || !workBlockId) throw new Error("Expected imported task and work block");
    expect(startedPlans).toEqual([{ taskId, workBlockId, accept: true }]);
  });
});

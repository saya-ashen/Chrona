import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "./db";
import {
  createCalendarSource,
  listCalendarSources,
  listImportedCalendarEventsInRange,
  markCalendarSourceRemoved,
  replaceImportedCalendarEvents,
  updateCalendarSource,
} from "./external-calendar";

async function reset() {
  await db.importedCalendarEvent.deleteMany();
  await db.calendarSource.deleteMany();
}

describe("external calendar repository", () => {
  beforeEach(reset);

  it("handles source lifecycle, filtering, and event dedupe", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Calendar DB", defaultRuntime: "debug", status: "Active" },
    });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Work",
      sourceUrl: "https://calendar.example/work.ics",
      redactedUrlLabel: "calendar.example/work.ics",
      color: "#2563eb",
    });

    await replaceImportedCalendarEvents(source.id, [{
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "event-1",
      dedupeKey: "event-1:single:2026-05-30T10:00:00.000Z",
      title: "Busy",
      startsAt: new Date("2026-05-30T10:00:00.000Z"),
      endsAt: new Date("2026-05-30T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
    }]);
    await replaceImportedCalendarEvents(source.id, [{
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "event-1",
      dedupeKey: "event-1:single:2026-05-30T10:00:00.000Z",
      title: "Busy updated",
      startsAt: new Date("2026-05-30T10:00:00.000Z"),
      endsAt: new Date("2026-05-30T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
    }]);

    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(0);
    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true, workBlocks: true } } },
    });
    expect(importedEvent.task?.title).toBe("Busy updated");
    expect(importedEvent.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-30T10:00:00.000Z");
    expect(importedEvent.task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe("2026-05-30T11:00:00.000Z");
    await updateCalendarSource(workspace.id, source.id, { lifecycleState: "disabled" });
    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(0);
    await markCalendarSourceRemoved(workspace.id, source.id);
    expect(await listCalendarSources(workspace.id)).toHaveLength(0);
  });

  it("applies source sync policy to complete past imported tasks", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Calendar policy DB", defaultRuntime: "debug", status: "Active" },
    });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Google Work",
      sourceUrl: "https://calendar.google.com/calendar/ical/work/basic.ics",
      redactedUrlLabel: "calendar.google.com/basic.ics",
      color: "#2563eb",
      syncPolicy: "auto_complete_past_events",
    });

    await replaceImportedCalendarEvents(source.id, [{
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "past-event-1",
      dedupeKey: "past-event-1:single:2026-05-01T10:00:00.000Z",
      title: "Past Google event",
      startsAt: new Date("2026-05-01T10:00:00.000Z"),
      endsAt: new Date("2026-05-01T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
    }], { now: new Date("2026-05-30T10:00:00.000Z") });

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true, workBlocks: true } } },
    });
    expect(importedEvent.task?.status).toBe("Completed");
    expect(importedEvent.task?.projection?.persistedStatus).toBe("Completed");
    expect(importedEvent.task?.projection?.persistedStatus).toBe("Completed");
    expect(importedEvent.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(importedEvent.task?.projection?.scheduledEndAt?.toISOString()).toBe("2026-05-01T11:00:00.000Z");
    expect(importedEvent.task?.projection?.scheduleStatus).toBe("Completed");
    expect(importedEvent.task?.workBlocks[0]?.status).toBe("Completed");
    expect(importedEvent.task?.workBlocks[0]?.scheduledStartAt.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(importedEvent.task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe("2026-05-01T11:00:00.000Z");
  });

  it("recreates imported event tasks when a stale taskId is left behind", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Calendar stale task DB", defaultRuntime: "debug", status: "Active" },
    });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Google Work",
      sourceUrl: "https://calendar.google.com/calendar/ical/work/basic.ics",
      redactedUrlLabel: "calendar.google.com/basic.ics",
      color: "#2563eb",
    });
    const write = {
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "stale-event-1",
      dedupeKey: "stale-event-1:single:2026-05-30T10:00:00.000Z",
      title: "Stale Google event",
      startsAt: new Date("2026-05-30T10:00:00.000Z"),
      endsAt: new Date("2026-05-30T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed" as const,
    };

    await replaceImportedCalendarEvents(source.id, [write]);
    const firstImportedEvent = await db.importedCalendarEvent.findFirstOrThrow({ where: { workspaceId: workspace.id } });
    const staleTaskId = firstImportedEvent.taskId;
    expect(staleTaskId).toBeTruthy();

    await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await db.$executeRawUnsafe(`DELETE FROM Task WHERE id = '${staleTaskId}'`);
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");

    await replaceImportedCalendarEvents(source.id, [{ ...write, title: "Recreated Google event" }]);

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true, workBlocks: true } } },
    });
    expect(importedEvent.taskId).not.toBe(staleTaskId);
    expect(importedEvent.task?.title).toBe("Recreated Google event");
    expect(importedEvent.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-30T10:00:00.000Z");
    expect(importedEvent.task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe("2026-05-30T11:00:00.000Z");
  });
});

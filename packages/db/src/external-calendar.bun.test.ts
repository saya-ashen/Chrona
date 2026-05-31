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

    const firstSync = await replaceImportedCalendarEvents(source.id, [{
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "event-1",
      dedupeKey: "event-1:single:2026-05-30T10:00:00.000Z",
      title: "Busy",
      startsAt: new Date("2026-05-30T10:00:00.000Z"),
      endsAt: new Date("2026-05-30T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
    }], { now: new Date("2026-05-29T10:00:00.000Z") });
    expect(firstSync.importedCount).toBe(1);
    expect(firstSync.automationRequests).toHaveLength(1);
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
    expect(importedEvent.task?.autoPlanGeneration).toBe(true);
    expect(importedEvent.task?.autoExecute).toBe(false);
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

    const syncResult = await replaceImportedCalendarEvents(source.id, [{
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
    expect(syncResult.automationRequests).toHaveLength(0);

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true, workBlocks: true } } },
    });
    expect(importedEvent.task?.status).toBe("Completed");
    expect(importedEvent.task?.autoPlanGeneration).toBe(true);
    expect(importedEvent.task?.autoExecute).toBe(false);
    expect(importedEvent.task?.projection?.persistedStatus).toBe("Completed");
    expect(importedEvent.task?.projection?.persistedStatus).toBe("Completed");
    expect(importedEvent.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(importedEvent.task?.projection?.scheduledEndAt?.toISOString()).toBe("2026-05-01T11:00:00.000Z");
    expect(importedEvent.task?.projection?.scheduleStatus).toBe("Completed");
    expect(importedEvent.task?.workBlocks[0]?.status).toBe("Completed");
    expect(importedEvent.task?.workBlocks[0]?.scheduledStartAt.toISOString()).toBe("2026-05-01T10:00:00.000Z");
    expect(importedEvent.task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe("2026-05-01T11:00:00.000Z");
  });

  it("applies calendar automation policy to newly imported future tasks", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Calendar automation DB", defaultRuntime: "debug", status: "Active" },
    });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Auto Run",
      sourceUrl: "https://calendar.example/auto.ics",
      redactedUrlLabel: "calendar.example/auto.ics",
      color: "#2563eb",
      automationPolicy: "auto_execute",
    });

    const result = await replaceImportedCalendarEvents(source.id, [{
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "future-event-1",
      dedupeKey: "future-event-1:single:2026-05-30T10:00:00.000Z",
      title: "Future automated event",
      startsAt: new Date("2026-05-30T10:00:00.000Z"),
      endsAt: new Date("2026-05-30T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
    }], { now: new Date("2026-05-29T10:00:00.000Z") });

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: true },
    });
    expect(importedEvent.task?.autoPlanGeneration).toBe(true);
    expect(importedEvent.task?.autoExecute).toBe(true);
    const taskId = importedEvent.task?.id;
    if (!taskId) throw new Error("Expected imported task");
    expect(result.automationRequests).toEqual([{ taskId, accept: true }]);
  });

  it("can import calendar tasks without automation", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Calendar manual DB", defaultRuntime: "debug", status: "Active" },
    });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Manual",
      sourceUrl: "https://calendar.example/manual.ics",
      redactedUrlLabel: "calendar.example/manual.ics",
      color: "#2563eb",
      automationPolicy: "manual",
    });

    const result = await replaceImportedCalendarEvents(source.id, [{
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "manual-event-1",
      dedupeKey: "manual-event-1:single:2026-05-30T10:00:00.000Z",
      title: "Manual event",
      startsAt: new Date("2026-05-30T10:00:00.000Z"),
      endsAt: new Date("2026-05-30T11:00:00.000Z"),
      isAllDay: false,
      status: "confirmed",
    }], { now: new Date("2026-05-29T10:00:00.000Z") });

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: true },
    });
    expect(importedEvent.task?.autoPlanGeneration).toBe(false);
    expect(importedEvent.task?.autoExecute).toBe(false);
    expect(result.automationRequests).toHaveLength(0);
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

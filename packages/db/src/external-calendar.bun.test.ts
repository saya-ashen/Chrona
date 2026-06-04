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

async function createWorkspaceAndCalendarSource(name: string) {
  const workspace = await db.workspace.create({
    data: { name, defaultRuntime: "debug", status: "Active" },
  });
  const source = await createCalendarSource({
    workspaceId: workspace.id,
    name: "Work",
    sourceUrl: `https://calendar.example/${workspace.id}.ics`,
    redactedUrlLabel: `calendar.example/${workspace.id}.ics`,
    color: "#2563eb",
  });
  return { workspace, source };
}

async function syncMovedEventFixture(sourceId: string, workspaceId: string, startHour: number, title: string, description: string) {
  const startsAt = `2026-05-30T${String(startHour).padStart(2, "0")}:00:00.000Z`;
  const endsAt = `2026-05-30T${String(startHour + 1).padStart(2, "0")}:30:00.000Z`;
  await replaceImportedCalendarEvents(sourceId, [{
    workspaceId,
    calendarSourceId: sourceId,
    externalUid: "moved-event-1",
    dedupeKey: `moved-event-1:single:${startsAt}`,
    title,
    description,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    isAllDay: false,
    status: "confirmed",
  }], { now: new Date("2026-05-29T10:00:00.000Z") });
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

    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(1);
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

  it("collapses existing expanded recurring calendar tasks into one task entry", async () => {
    const { workspace, source } = await createWorkspaceAndCalendarSource("Calendar collapse DB");
    const events = [0, 1, 2].map((index) => ({
      workspaceId: workspace.id,
      calendarSourceId: source.id,
      externalUid: "recurring-event-1",
      recurrenceId: `2026060${index + 1}T090000Z`,
      recurrenceRule: "FREQ=DAILY;COUNT=3",
      dedupeKey: `recurring-event-1:2026060${index + 1}T090000Z:2026-06-0${index + 1}T09:00:00.000Z`,
      title: "Daily standup",
      startsAt: new Date(`2026-06-0${index + 1}T09:00:00.000Z`),
      endsAt: new Date(`2026-06-0${index + 1}T09:30:00.000Z`),
      isAllDay: false,
      status: "confirmed" as const,
    }));

    await replaceImportedCalendarEvents(source.id, events, { now: new Date("2026-05-30T10:00:00.000Z") });
    const expandedEvents = await db.importedCalendarEvent.findMany({ where: { calendarSourceId: source.id } });
    await db.importedCalendarEvent.updateMany({ where: { calendarSourceId: source.id }, data: { taskId: null, workBlockId: null } });
    await db.workBlock.deleteMany({ where: { workspaceId: workspace.id } });
    await db.taskProjection.deleteMany({ where: { workspaceId: workspace.id } });
    await db.task.deleteMany({ where: { workspaceId: workspace.id } });
    for (const event of expandedEvents) {
      await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: `legacy ${event.recurrenceId}`,
          status: "Ready",
          priority: "Medium",
          executionRuntime: "debug",
          executionConfig: {},
          kind: "single",
          recurrenceRule: event.recurrenceRule,
          importedCalendarEvents: { connect: { id: event.id } },
          workBlocks: {
            create: {
              workspaceId: workspace.id,
              title: event.title,
              status: "Scheduled",
              scheduledStartAt: event.startsAt,
              scheduledEndAt: event.endsAt,
              trigger: "manual",
            },
          },
        },
      });
    }
    expect(await db.task.count({ where: { workspaceId: workspace.id } })).toBe(3);

    await replaceImportedCalendarEvents(source.id, events, { now: new Date("2026-05-30T10:00:00.000Z") });

    const tasks = await db.task.findMany({
      where: { workspaceId: workspace.id },
      include: { workBlocks: { orderBy: { scheduledStartAt: "asc" } } },
    });
    const imported = await db.importedCalendarEvent.findMany({ where: { calendarSourceId: source.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.kind).toBe("recurring");
    expect(tasks[0]?.workBlocks).toHaveLength(3);
    expect(new Set(imported.map((event) => event.taskId)).size).toBe(1);
    expect(imported.every((event) => event.taskId === tasks[0]?.id)).toBe(true);
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
      include: { task: true, workBlock: true },
    });
    expect(importedEvent.task?.autoPlanGeneration).toBe(true);
    expect(importedEvent.task?.autoExecute).toBe(true);
    const taskId = importedEvent.task?.id;
    const workBlockId = importedEvent.workBlock?.id;
    if (!taskId || !workBlockId) throw new Error("Expected imported task and work block");
    expect(result.automationRequests).toEqual([{ taskId, workBlockId, accept: true }]);
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

  it("moves imported tasks when the remote event time changes", async () => {
    const { workspace, source } = await createWorkspaceAndCalendarSource("Calendar moved event DB");
    await syncMovedEventFixture(source.id, workspace.id, 10, "Original meeting", "Original calendar description");
    const firstImportedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: true, workBlock: true },
    });
    if (!firstImportedEvent.taskId || !firstImportedEvent.workBlockId) throw new Error("Expected linked import");
    await db.task.update({
      where: { id: firstImportedEvent.taskId },
      data: { description: "Chrona local notes" },
    });

    await syncMovedEventFixture(source.id, workspace.id, 12, "Moved meeting", "Updated calendar description");

    const importedEvents = await db.importedCalendarEvent.findMany({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true } }, workBlock: true },
    });
    expect(importedEvents).toHaveLength(1);
    expect(importedEvents[0]?.id).toBe(firstImportedEvent.id);
    expect(importedEvents[0]?.taskId).toBe(firstImportedEvent.taskId);
    expect(importedEvents[0]?.workBlockId).toBe(firstImportedEvent.workBlockId);
    expect(importedEvents[0]?.description).toBe("Updated calendar description");
    expect(importedEvents[0]?.task?.description).toBe("Chrona local notes");
    expect(importedEvents[0]?.task?.title).toBe("Moved meeting");
    expect(importedEvents[0]?.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-30T12:00:00.000Z");
    expect(importedEvents[0]?.workBlock?.scheduledEndAt.toISOString()).toBe("2026-05-30T13:30:00.000Z");
  });

  it("cancels imported tasks when remote events disappear", async () => {
    const { workspace, source } = await createWorkspaceAndCalendarSource("Calendar removed event DB");
    await syncMovedEventFixture(source.id, workspace.id, 10, "Removed meeting", "Removed calendar description");

    await replaceImportedCalendarEvents(source.id, [], { now: new Date("2026-05-29T10:00:00.000Z") });

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true, workBlocks: true } } },
    });
    expect(importedEvent.status).toBe("cancelled");
    expect(importedEvent.task?.status).toBe("Cancelled");
    expect(importedEvent.task?.projection?.persistedStatus).toBe("Cancelled");
    expect(importedEvent.task?.projection?.scheduledStartAt).toBeNull();
    expect(importedEvent.task?.workBlocks[0]?.status).toBe("Cancelled");
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

  it("recreates imported event work blocks when a stale workBlockId is left behind", async () => {
    const { workspace, source } = await createWorkspaceAndCalendarSource("Calendar stale work block DB");
    await syncMovedEventFixture(source.id, workspace.id, 10, "Original meeting", "Original calendar description");
    const firstImportedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { workBlock: true },
    });
    const staleWorkBlockId = firstImportedEvent.workBlockId;
    expect(staleWorkBlockId).toBeTruthy();

    await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    await db.$executeRawUnsafe(`DELETE FROM WorkBlock WHERE id = '${staleWorkBlockId}'`);
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");

    await syncMovedEventFixture(source.id, workspace.id, 12, "Recovered meeting", "Recovered calendar description");

    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { workBlocks: true } }, workBlock: true },
    });
    expect(importedEvent.workBlockId).not.toBe(staleWorkBlockId);
    expect(importedEvent.workBlock?.scheduledStartAt.toISOString()).toBe("2026-05-30T12:00:00.000Z");
    expect(importedEvent.workBlock?.scheduledEndAt.toISOString()).toBe("2026-05-30T13:30:00.000Z");
    expect(importedEvent.task?.workBlocks).toHaveLength(1);
  });
});

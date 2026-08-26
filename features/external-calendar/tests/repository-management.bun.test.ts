import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@chrona/db";
import {
  createCalendarSource,
  listCalendarSources,
  listImportedCalendarEventsInRange,
  markCalendarSourceRemoved,
  replaceImportedCalendarEvents,
  updateCalendarSource,
  updateCalendarSourceSyncStatus,
} from "../repository";

async function reset() {
  await db.importedCalendarEvent.deleteMany();
  await db.calendarSource.deleteMany();
}

describe("external calendar management repository", () => {
  beforeEach(reset);

  it("updates refresh metadata and clears stale errors on success", async () => {
    const workspace = await db.workspace.create({ data: { name: "Refresh DB", status: "Active" } });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Work",
      sourceUrl: "https://calendar.example/work.ics",
      redactedUrlLabel: "calendar.example",
      color: "#2563eb",
    });

    await updateCalendarSourceSyncStatus(workspace.id, source.id, {
      syncState: "failed",
      lastErrorCode: "malformed_calendar",
      lastErrorMessage: "Calendar feed could not be read.",
    });
    const refreshedAt = new Date("2026-05-30T12:00:00.000Z");
    const nextAt = new Date("2026-05-30T13:00:00.000Z");
    const updated = await updateCalendarSourceSyncStatus(workspace.id, source.id, {
      syncState: "success",
      importedCount: 3,
      skippedCount: 0,
      lastSuccessfulRefreshAt: refreshedAt,
      nextExpectedRefreshAt: nextAt,
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    expect(updated.syncState).toBe("success");
    expect(updated.importedCount).toBe(3);
    expect(updated.lastErrorCode).toBeNull();
    expect(updated.lastErrorMessage).toBeNull();
    expect(updated.lastSuccessfulRefreshAt?.toISOString()).toBe(refreshedAt.toISOString());
    expect(updated.nextExpectedRefreshAt?.toISOString()).toBe(nextAt.toISOString());
  });

  it("excludes removed sources and hides disabled source events", async () => {
    const workspace = await db.workspace.create({ data: { name: "Lifecycle DB", status: "Active" } });
    const source = await createCalendarSource({
      workspaceId: workspace.id,
      name: "Busy",
      sourceUrl: "https://calendar.example/busy.ics",
      redactedUrlLabel: "calendar.example",
      color: "#0f766e",
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

    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(1);
    const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
      where: { workspaceId: workspace.id },
      include: { task: { include: { projection: true, workBlocks: true } } },
    });
    expect(importedEvent.task?.title).toBe("Busy");
    expect(importedEvent.task?.projection?.scheduledStartAt?.toISOString()).toBe("2026-05-30T10:00:00.000Z");
    expect(importedEvent.task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe("2026-05-30T11:00:00.000Z");
    await updateCalendarSource(workspace.id, source.id, { lifecycleState: "disabled" });
    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(0);
    await updateCalendarSource(workspace.id, source.id, { lifecycleState: "active" });
    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(1);

    await markCalendarSourceRemoved(workspace.id, source.id);
    expect(await listCalendarSources(workspace.id)).toHaveLength(0);
    expect(await listImportedCalendarEventsInRange(workspace.id, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toHaveLength(0);
  });
});

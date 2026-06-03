import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";

import { createApiRouter } from "../../routes/api";
import { json, resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function seedSource(workspaceId: string, overrides: Partial<{
  name: string;
  color: string;
  lifecycleState: "active" | "disabled" | "removed";
}> = {}) {
  return await db.calendarSource.create({
    data: {
      workspaceId,
      name: overrides.name ?? "Team Calendar",
      sourceUrl: `file:///tmp/${crypto.randomUUID()}.ics`,
      redactedUrlLabel: "local fixture",
      color: overrides.color ?? "#2563eb",
      lifecycleState: overrides.lifecycleState ?? "active",
    },
  });
}

async function seedImportedEvent(input: {
  workspaceId: string;
  calendarSourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status?: "confirmed" | "tentative" | "cancelled";
}) {
  // Busy blocks surface imported occurrences, so link each seeded event to its
  // own occurrence task the way the importer does.
  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title: input.title,
      executionRuntime: "debug",
      executionConfig: {},
      status: "Ready",
      priority: "Medium",
      kind: "single",
      recurrenceRule: "FREQ=WEEKLY",
      seriesExternalUid: crypto.randomUUID(),
    },
  });
  return await db.importedCalendarEvent.create({
    data: {
      workspaceId: input.workspaceId,
      calendarSourceId: input.calendarSourceId,
      taskId: task.id,
      externalUid: crypto.randomUUID(),
      dedupeKey: crypto.randomUUID(),
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      isAllDay: false,
      status: input.status ?? "confirmed",
    },
  });
}

describe("External calendar event API", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns imported events in the requested date range with read-only metadata", async () => {
    const { workspaceId } = await seedWorkspace("Calendar events");
    const source = await seedSource(workspaceId, { name: "Product Calendar", color: "#0f766e" });
    await seedImportedEvent({
      workspaceId,
      calendarSourceId: source.id,
      title: "Design review",
      startsAt: new Date("2026-04-15T09:00:00.000Z"),
      endsAt: new Date("2026-04-15T10:00:00.000Z"),
    });
    await seedImportedEvent({
      workspaceId,
      calendarSourceId: source.id,
      title: "Outside range",
      startsAt: new Date("2026-04-16T09:00:00.000Z"),
      endsAt: new Date("2026-04-16T10:00:00.000Z"),
    });

    const res = await app().request(
      `http://local/api/workspaces/${workspaceId}/calendar-events?from=2026-04-15T00:00:00.000Z&to=2026-04-16T00:00:00.000Z`,
    );

    expect(res.status).toBe(200);
    const body = await json<{ events: Array<{ title: string; sourceName: string; sourceColor: string; readOnly: true }> }>(res);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      title: "Design review",
      sourceName: "Product Calendar",
      sourceColor: "#0f766e",
      readOnly: true,
    });
  });

  it("filters by enabled active source and excludes disabled and cancelled events", async () => {
    const { workspaceId } = await seedWorkspace("Calendar filters");
    const active = await seedSource(workspaceId, { name: "Active Calendar" });
    const disabled = await seedSource(workspaceId, { name: "Disabled Calendar", lifecycleState: "disabled" });
    await seedImportedEvent({
      workspaceId,
      calendarSourceId: active.id,
      title: "Active event",
      startsAt: new Date("2026-04-15T09:00:00.000Z"),
      endsAt: new Date("2026-04-15T10:00:00.000Z"),
    });
    await seedImportedEvent({
      workspaceId,
      calendarSourceId: active.id,
      title: "Cancelled event",
      startsAt: new Date("2026-04-15T11:00:00.000Z"),
      endsAt: new Date("2026-04-15T12:00:00.000Z"),
      status: "cancelled",
    });
    await seedImportedEvent({
      workspaceId,
      calendarSourceId: disabled.id,
      title: "Disabled event",
      startsAt: new Date("2026-04-15T13:00:00.000Z"),
      endsAt: new Date("2026-04-15T14:00:00.000Z"),
    });

    const res = await app().request(
      `http://local/api/workspaces/${workspaceId}/calendar-events?from=2026-04-15&to=2026-04-16&sourceId=${active.id}`,
    );

    expect(res.status).toBe(200);
    const body = await json<{ events: Array<{ title: string }> }>(res);
    expect(body.events.map((event) => event.title)).toEqual(["Active event"]);
  });

  it("does not create task records when listing imported calendar events", async () => {
    const { workspaceId } = await seedWorkspace("Calendar no tasks");
    const source = await seedSource(workspaceId);
    await seedTask(workspaceId, { title: "Existing task" });
    await seedImportedEvent({
      workspaceId,
      calendarSourceId: source.id,
      title: "External meeting",
      startsAt: new Date("2026-04-15T09:00:00.000Z"),
      endsAt: new Date("2026-04-15T10:00:00.000Z"),
    });

    const before = await db.task.count({ where: { workspaceId } });

    await app().request(
      `http://local/api/workspaces/${workspaceId}/calendar-events?from=2026-04-15&to=2026-04-16`,
    );

    const after = await db.task.count({ where: { workspaceId } });
    expect(after).toBe(before);
  });

  it("rejects invalid date ranges", async () => {
    const { workspaceId } = await seedWorkspace("Calendar invalid range");

    const res = await app().request(
      `http://local/api/workspaces/${workspaceId}/calendar-events?from=2026-04-16&to=2026-04-15`,
    );

    expect(res.status).toBe(400);
  });
});

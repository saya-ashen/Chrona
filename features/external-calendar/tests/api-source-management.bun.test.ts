import { beforeEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import type { CalendarFeedTransport } from "@chrona/integrations";

import { createApiRouter } from "@chrona/server/routes";
import { json, resetTestDb, seedWorkspace } from "@server/__tests__/bun-test-helpers";

const FIXTURE_NOW = new Date("2026-05-01T00:00:00.000Z");

function app(transport = fixtureTransport) {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine(), { calendarSources: { transport, now: () => FIXTURE_NOW } }));
  return server;
}

function fixtureUrl(name: string) {
  return `https://calendar-fixtures.test/${name}`;
}

async function fixture(name: string) {
  return await readFile(new URL(`../../../packages/integrations/src/calendar/fixtures/${name}`, import.meta.url), "utf8");
}

const fixtureTransport: CalendarFeedTransport = async (url) => {
  const name = new URL(url).pathname.slice(1);
  return { status: 200, text: name === "partial.ics" ? partialFeed : await fixture(name) };
};

const partialFeed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chrona//Management Test//EN
BEGIN:VEVENT
UID:partial-good@example.test
DTSTAMP:20260501T080000Z
DTSTART:20260504T100000Z
DTEND:20260504T103000Z
SUMMARY:Partial refresh event
END:VEVENT
BEGIN:VEVENT
UID:partial-bad@example.test
DTSTART:not-a-date
SUMMARY:Broken event
END:VEVENT
END:VCALENDAR
`;

describe("External calendar source management API", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("lists, renames, recolors, disables, enables, refreshes, and idempotently removes a source", async () => {
    const { workspaceId } = await seedWorkspace("Calendar management");
    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team calendar", url: fixtureUrl("valid.ics"), color: "#2563eb" }),
    });
    expect(createRes.status).toBe(201);
    const created = await json<{ source: { id: string; name: string; lifecycleState: string; redactedUrlLabel: string } }>(createRes);

    const listRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`);
    expect(listRes.status).toBe(200);
    const listed = await json<{ sources: Array<{ id: string; redactedUrlLabel: string }> }>(listRes);
    expect(listed.sources.map((source) => source.id)).toContain(created.source.id);
    expect(JSON.stringify(listed)).not.toContain(fixtureUrl("valid.ics"));

    const patchRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed calendar", color: "#0f766e", enabled: false }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await json<{ source: { name: string; color: string; lifecycleState: string } }>(patchRes);
    expect(patched.source).toMatchObject({ name: "Renamed calendar", color: "#0f766e", lifecycleState: "disabled" });

    const disabledEventsRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-events?from=2026-05-04T00:00:00.000Z&to=2026-05-05T00:00:00.000Z`);
    expect((await json<{ events: unknown[] }>(disabledEventsRes)).events).toHaveLength(0);

    const enableRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(enableRes.status).toBe(200);
    const enabled = await json<{ source: { lifecycleState: string } }>(enableRes);
    expect(enabled.source.lifecycleState).toBe("active");

    const refreshRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}/refresh`, { method: "POST" });
    expect(refreshRes.status).toBe(200);
    const refreshed = await json<{ syncStatus: { state: string; importedCount: number; latestErrorMessage?: string } }>(refreshRes);
    expect(refreshed.syncStatus.state).toBe("success");
    expect(refreshed.syncStatus.importedCount).toBe(1);
    expect(refreshed.syncStatus.latestErrorMessage).toBeUndefined();

    const deleteRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
    const deleteAgainRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}`, { method: "DELETE" });
    expect(deleteAgainRes.status).toBe(200);

    const removedListRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`);
    expect((await json<{ sources: unknown[] }>(removedListRes)).sources).toHaveLength(0);
  });

  it("reports partial refreshes and preserves imported events after refresh failure", async () => {
    const { workspaceId } = await seedWorkspace("Calendar refresh health");
    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Health calendar", url: fixtureUrl("valid.ics") }),
    });
    const created = await json<{ source: { id: string } }>(createRes);

    await db.calendarSource.update({ where: { id: created.source.id, workspaceId }, data: { sourceUrl: fixtureUrl("partial.ics") } });
    const partialRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}/refresh`, { method: "POST" });
    expect(partialRes.status).toBe(200);
    const partial = await json<{ syncStatus: { state: string; importedCount: number; skippedCount: number } }>(partialRes);
    expect(partial.syncStatus).toMatchObject({ state: "partial", importedCount: 1, skippedCount: 1 });

    await db.calendarSource.update({ where: { id: created.source.id, workspaceId }, data: { sourceUrl: fixtureUrl("malformed.ics") } });
    const failedRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/${created.source.id}/refresh`, { method: "POST" });
    expect(failedRes.status).toBe(200);
    const failed = await json<{ syncStatus: { state: string; latestErrorCode?: string; importedCount: number } }>(failedRes);
    expect(failed.syncStatus.state).toBe("failed");
    expect(failed.syncStatus.latestErrorCode).toBe("malformed_calendar");

    const eventsRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-events?from=2026-05-04T00:00:00.000Z&to=2026-05-05T00:00:00.000Z`);
    expect((await json<{ events: Array<{ title: string }> }>(eventsRes)).events.map((event) => event.title)).toEqual(["Partial refresh event"]);
    const importedEvents = await db.importedCalendarEvent.findMany({
      where: { workspaceId },
      include: { task: { include: { projection: true, workBlocks: true } } },
      orderBy: { startsAt: "asc" },
    });
    expect(importedEvents).toHaveLength(2);
    expect(importedEvents[0]?.task?.projection).toBeTruthy();
    expect(importedEvents[0]?.task?.workBlocks[0]).toBeTruthy();
    expect(importedEvents[1]?.task?.projection).toBeTruthy();
    expect(importedEvents[1]?.task?.workBlocks[0]).toBeTruthy();
  });
});

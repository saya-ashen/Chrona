import { beforeEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import type { CalendarFeedTransport } from "@chrona/integrations";

import { createApiRouter } from "../../routes/api";
import { json, resetTestDb, seedWorkspace } from "../bun-test-helpers";

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
  return await readFile(new URL(`../../../../../packages/integrations/src/calendar/fixtures/${name}`, import.meta.url), "utf8");
}

const fixtureTransport: CalendarFeedTransport = async (url) => ({
  status: 200,
  text: await fixture(new URL(url).pathname.slice(1)),
});

async function expectImportedFixtureEvent(workspaceId: string) {
  const importedEvent = await db.importedCalendarEvent.findFirstOrThrow({
    where: { workspaceId },
    include: { task: { include: { projection: true, workBlocks: true } } },
    orderBy: { startsAt: "asc" },
  });
  const task = importedEvent.task;
  expect(task).toBeTruthy();
  expect(importedEvent.description).toBe("Discuss sync blockers and handoff notes.");
  expect(task?.title).toBe(importedEvent.title);
  expect(task?.description).toBeNull();
  expect(task?.projection?.scheduledStartAt?.toISOString()).toBe(importedEvent.startsAt.toISOString());
  expect(task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe(importedEvent.endsAt.toISOString());
}

describe("External calendar source API", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("validates and creates a fixture-backed source with redacted metadata", async () => {
    const { workspaceId } = await seedWorkspace("Calendar API");
    const url = fixtureUrl("valid.ics");

    const validateRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    expect(validateRes.status).toBe(200);
    const validation = await json<{ valid: boolean; redactedUrlLabel?: string; eventPreviewCount?: number }>(validateRes);
    expect(validation.valid).toBe(true);
    expect(validation.eventPreviewCount).toBeGreaterThan(0);
    expect(validation.redactedUrlLabel).toBe("calendar-fixtures.test/valid.ics");
    expect(JSON.stringify(validation)).not.toContain(url);

    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team calendar", url, color: "#0f766e" }),
    });
    expect(createRes.status).toBe(201);
    const created = await json<{
      source: { name: string; redactedUrlLabel: string; color: string; automationPolicy: string };
      syncStatus: { importedCount: number; state: string };
    }>(createRes);
    expect(created.source.name).toBe("Team calendar");
    expect(created.source.redactedUrlLabel).toBe("calendar-fixtures.test/valid.ics");
    expect(created.source.color).toBe("#0f766e");
    expect(created.source.automationPolicy).toBe("manual");
    expect(created.syncStatus.importedCount).toBeGreaterThan(0);
    expect(created.syncStatus.state).toBe("success");
    expect(JSON.stringify(created)).not.toContain(url);

    await expectImportedFixtureEvent(workspaceId);
  });

  it("imports bounded recurring calendar occurrences as tasks", async () => {
    const { workspaceId } = await seedWorkspace("Calendar recurring API");
    const url = fixtureUrl("recurring.ics");

    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Recurring calendar", url }),
    });

    expect(createRes.status).toBe(201);
    const created = await json<{ syncStatus: { importedCount: number; state: string } }>(createRes);
    expect(created.syncStatus).toMatchObject({ importedCount: 3, state: "success" });

    const importedEvents = await db.importedCalendarEvent.findMany({
      where: { workspaceId },
      include: { task: true, workBlock: true },
      orderBy: { startsAt: "asc" },
    });

    expect(importedEvents.map((event: { startsAt: Date }) => event.startsAt.toISOString())).toEqual([
      "2026-05-05T14:00:00.000Z",
      "2026-05-12T14:00:00.000Z",
      "2026-05-19T14:00:00.000Z",
    ]);
    expect(importedEvents.every((event: { recurrenceId: string | null }) => event.recurrenceId)).toBe(true);

    const occurrenceTaskIds = importedEvents.map((event: { taskId: string | null }) => event.taskId);
    expect(new Set(occurrenceTaskIds).size).toBe(1);

    const tasks = await db.task.findMany({
      where: { workspaceId },
      include: { workBlocks: { orderBy: { scheduledStartAt: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.kind).toBe("recurring");
    expect(tasks[0]?.recurrenceRule?.includes("FREQ=WEEKLY")).toBe(true);
    expect(tasks[0]?.seriesExternalUid).toBeNull();
    expect(tasks[0]?.workBlocks.length).toBe(3);
    expect(
      tasks
        .flatMap((task) => task.workBlocks)
        .map((block: { scheduledStartAt: Date }) => block.scheduledStartAt.toISOString())
        .sort(),
    ).toEqual([
      "2026-05-05T14:00:00.000Z",
      "2026-05-12T14:00:00.000Z",
      "2026-05-19T14:00:00.000Z",
    ]);
    expect(importedEvents.every((event: { workBlockId: string | null }) => event.workBlockId)).toBe(true);
  });

  it("rejects unsupported URLs without saving", async () => {
    const { workspaceId } = await seedWorkspace("Calendar invalid URL");

    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad calendar", url: "ftp://example.test/private.ics" }),
    });
    expect(createRes.status).toBe(400);
    const rejected = await json<{ valid: boolean; errorCode: string; message: string }>(createRes);
    expect(rejected.valid).toBe(false);
    expect(rejected.errorCode).toBe("unsupported_scheme");

    const listRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`);
    const listed = await json<{ sources: unknown[] }>(listRes);
    expect(listed.sources).toEqual([]);
  });

  it("requires confirmation before saving blocked-network calendar sources", async () => {
    const { workspaceId } = await seedWorkspace("Calendar blocked network");
    const url = fixtureUrl("valid.ics");
    const blockedTransport: CalendarFeedTransport = async () => {
      const { CalendarFeedError } = await import("@chrona/integrations");
      throw new CalendarFeedError("blocked_network", "Calendar host resolves to a blocked network.");
    };

    const rejectedRes = await app(blockedTransport).request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Proxy calendar", url }),
    });
    expect(rejectedRes.status).toBe(400);
    const rejected = await json<{ valid: boolean; errorCode: string }>(rejectedRes);
    expect(rejected.valid).toBe(false);
    expect(rejected.errorCode).toBe("blocked_network");

    const acceptedRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Proxy calendar", url, allowBlockedNetwork: true }),
    });
    expect(acceptedRes.status).toBe(201);
    const source = await db.calendarSource.findFirstOrThrow({ where: { workspaceId } });
    expect(source.blockedNetworkConfirmedAt).toBeInstanceOf(Date);
  });

  it("rejects malformed feeds without saving", async () => {
    const { workspaceId } = await seedWorkspace("Calendar malformed");

    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Broken calendar", url: fixtureUrl("malformed.ics") }),
    });
    expect(createRes.status).toBe(400);
    const rejected = await json<{ valid: boolean; errorCode: string }>(createRes);
    expect(rejected.valid).toBe(false);
    expect(rejected.errorCode).toBe("malformed_calendar");

    const listRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`);
    const listed = await json<{ sources: unknown[] }>(listRes);
    expect(listed.sources).toHaveLength(0);
  });

  it("accepts an empty calendar source", async () => {
    const { workspaceId } = await seedWorkspace("Calendar empty");

    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Empty calendar", url: fixtureUrl("empty.ics") }),
    });
    expect(createRes.status).toBe(201);
    const created = await json<{ syncStatus: { importedCount: number; state: string } }>(createRes);
    expect(created.syncStatus.importedCount).toBe(0);
    expect(created.syncStatus.state).toBe("success");
  });

  it("returns validation errors for malformed request bodies", async () => {
    const { workspaceId } = await seedWorkspace("Calendar body validation");

    const res = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", url: "not-a-url", color: "blue" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});

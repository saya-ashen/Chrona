import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";

import { createApiRouter } from "../../routes/api";
import { json, resetTestDb, seedWorkspace } from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

function fixtureUrl(name: string) {
  return new URL(`../../../../../packages/integrations/src/calendar/fixtures/${name}`, import.meta.url).href;
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
    expect(validation.redactedUrlLabel).toBe("local fixture");
    expect(JSON.stringify(validation)).not.toContain(url);

    const createRes = await app().request(`http://local/api/workspaces/${workspaceId}/calendar-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team calendar", url, color: "#0f766e" }),
    });
    expect(createRes.status).toBe(201);
    const created = await json<{
      source: { name: string; redactedUrlLabel: string; color: string };
      syncStatus: { importedCount: number; state: string };
    }>(createRes);
    expect(created.source.name).toBe("Team calendar");
    expect(created.source.redactedUrlLabel).toBe("local fixture");
    expect(created.source.color).toBe("#0f766e");
    expect(created.syncStatus.importedCount).toBeGreaterThan(0);
    expect(created.syncStatus.state).toBe("success");
    expect(JSON.stringify(created)).not.toContain(url);

    const importedEvents = await db.importedCalendarEvent.findMany({
      where: { workspaceId },
      include: { task: { include: { projection: true, workBlocks: true } } },
      orderBy: { startsAt: "asc" },
    });
    expect(importedEvents.length).toBeGreaterThan(0);
    expect(importedEvents[0]?.task).toBeTruthy();
    expect(importedEvents[0]?.description).toBe("Discuss sync blockers and handoff notes.");
    expect(importedEvents[0]?.task?.title).toBe(importedEvents[0]?.title);
    expect(importedEvents[0]?.task?.description).toBeNull();
    expect(importedEvents[0]?.task?.projection?.scheduledStartAt?.toISOString()).toBe(importedEvents[0]?.startsAt.toISOString());
    expect(importedEvents[0]?.task?.workBlocks[0]?.scheduledEndAt.toISOString()).toBe(importedEvents[0]?.endsAt.toISOString());
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

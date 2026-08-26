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

describe("External task edit roundtrip (PATCH config + schedule PUT)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("persists Chrona notes when saving an external task with a minute-truncated window", async () => {
    const { workspaceId } = await seedWorkspace("External edit");
    const source = await db.calendarSource.create({
      data: {
        workspaceId,
        name: "Product Calendar",
        sourceUrl: `file:///tmp/${crypto.randomUUID()}.ics`,
        redactedUrlLabel: "local",
        color: "#0f766e",
        lifecycleState: "active",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId,
        title: "Imported standup",
        description: null,
        status: "Ready",
        priority: "Medium",
        executionConfig: {},
      },
    });
    // Source carries sub-minute precision, like real ICS feeds.
    const sourceStart = new Date("2026-04-20T09:00:37.500Z");
    const sourceEnd = new Date("2026-04-20T10:00:37.500Z");
    await db.importedCalendarEvent.create({
      data: {
        workspaceId,
        calendarSourceId: source.id,
        taskId: task.id,
        externalUid: crypto.randomUUID(),
        dedupeKey: crypto.randomUUID(),
        title: "Imported standup",
        startsAt: sourceStart,
        endsAt: sourceEnd,
        isAllDay: false,
        status: "confirmed",
        description: "Calendar agenda from source",
      },
    });
    // Calendar sync owns the occurrence's work block.
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId: task.id,
        recurrenceKey: sourceStart.toISOString(),
        title: "Imported standup",
        status: "Scheduled",
        scheduledStartAt: sourceStart,
        scheduledEndAt: sourceEnd,
        trigger: "manual",
      },
    });

    // Step 1: PATCH config — edit only the Chrona notes (mirrors frontend save).
    const patchRes = await app().request(`http://local/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Imported standup", description: "My local notes" }),
    });
    expect(patchRes.status).toBe(200);

    // Step 2: schedule PUT — frontend resubmits the locked window, truncated to minute precision.
    const scheduleRes = await app().request(`http://local/api/tasks/${task.id}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dueAt: null,
        scheduledStartAt: "2026-04-20T09:00:00.000Z",
        scheduledEndAt: "2026-04-20T10:00:00.000Z",
        scheduleSource: "human",
      }),
    });
    // Previously this threw "managed by the calendar source" and the frontend rolled back.
    expect(scheduleRes.status).toBe(200);

    // The Chrona notes survive and are echoed back distinctly from the calendar description.
    const pageRes = await app().request(`http://local/api/tasks/${task.id}`);
    expect(pageRes.status).toBe(200);
    const page = await json<{ task: { description: string | null; sourceManaged: { description: string | null } | null } }>(pageRes);
    expect(page.task.description).toBe("My local notes");
    expect(page.task.sourceManaged?.description).toBe("Calendar agenda from source");

    // The calendar-owned work block window is untouched, so the projection
    // still reflects the authoritative source times — applySchedule must not
    // have created or moved a work block for this externally managed task.
    const workBlocks = await db.workBlock.findMany({ where: { taskId: task.id } });
    expect(workBlocks).toHaveLength(1);
    expect(workBlocks[0]?.scheduledStartAt.toISOString()).toBe(sourceStart.toISOString());
    expect(workBlocks[0]?.scheduledEndAt.toISOString()).toBe(sourceEnd.toISOString());
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.scheduledStartAt?.toISOString()).toBe(sourceStart.toISOString());
    expect(projection.scheduledEndAt?.toISOString()).toBe(sourceEnd.toISOString());
  });
});

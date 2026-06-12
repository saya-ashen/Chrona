import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// GET /api/tasks/:taskId/activity — task activity timeline.
// Coverage audit gap: zero L1 coverage. The route returns the
// merged activity (timeline items + canonical events) for a
// task. Pinned cases:
//   - empty timeline returns empty items array with scope info
//   - canonical event rows surface in the merged activity
//   - ?limit caps the number of items returned

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function seedCanonicalEvent(workspaceId: string, taskId: string, eventType: string, index = 0) {
  return await db.event.create({
    data: {
      workspaceId,
      taskId,
      eventType,
      actorType: "user",
      actorId: "test-user",
      source: "test",
      payload: { index },
      dedupeKey: `activity-test-${eventType}-${index}-${crypto.randomUUID()}`,
      occurredAt: new Date(`2030-01-01T00:00:0${index}.000Z`),
      ingestSequence: index + 1,
    },
  });
}

describe("GET /api/tasks/:taskId/activity", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("returns empty items and the right scope for a task with no events", async () => {
    const { workspaceId } = await seedWorkspace("Empty activity");
    const { taskId } = await seedTask(workspaceId, { title: "Quiet task" });

    const res = await app().request(`http://local/api/tasks/${taskId}/activity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      nextCursor?: string;
      scope: { type: string; taskId: string; limit: number };
    };
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
    expect(body.scope).toEqual({ type: "task", taskId, limit: 100 });
  });

  it("surfaces canonical events in the merged activity", async () => {
    const { workspaceId } = await seedWorkspace("Activity events");
    const { taskId } = await seedTask(workspaceId, { title: "Active task" });
    await seedCanonicalEvent(workspaceId, taskId, "task.created", 0);
    await seedCanonicalEvent(workspaceId, taskId, "task.status_changed", 1);

    const res = await app().request(`http://local/api/tasks/${taskId}/activity`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ eventType?: string; title?: string; summary?: string }>;
    };
    // The merged activity should include at least the 2
    // canonical events we seeded, in some recognized form
    // (title or raw eventType). We don't pin the exact title
    // mapping since the engine may evolve it.
    const eventTypes = body.items.map((i) => i.eventType).filter(Boolean);
    const titles = body.items.map((i) => i.title).filter(Boolean);
    expect(eventTypes.length + titles.length).toBeGreaterThan(0);
    expect(body.items.length).toBeGreaterThanOrEqual(2);
  });

  it("respects ?limit query parameter (cap = 1)", async () => {
    const { workspaceId } = await seedWorkspace("Activity limit");
    const { taskId } = await seedTask(workspaceId, { title: "Many events" });
    for (let index = 0; index < 5; index += 1) {
      await seedCanonicalEvent(workspaceId, taskId, "task.note_appended", index);
    }

    const res = await app().request(`http://local/api/tasks/${taskId}/activity?limit=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      scope: { limit: number };
    };
    expect(body.items).toHaveLength(1);
    expect(body.scope.limit).toBe(1);
  });
});

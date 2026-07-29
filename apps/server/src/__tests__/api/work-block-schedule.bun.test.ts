import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createChronaEngine } from "@chrona/engine";
import { db } from "@chrona/db";
import { moveWorkBlock } from "@chrona/engine/test-support";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// WorkBlock reschedule — the PUT /api/work-blocks/:workBlockId/schedule
// endpoint. Covered at the engine layer for the reschedule contract;
// the route surface is exercised through the real router to keep
// the contract end-to-end.
//
// Coverage audit gap: this was the only schedule endpoint with
// zero L1/L2/L3 coverage. Pinned cases:
//   - happy path: reschedule a Scheduled block updates the row
//   - rejected: Active block cannot be rescheduled
//   - rejected: Completed/Cancelled block cannot be rescheduled
//   - 400 on missing/invalid body

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function seedWorkBlock(workspaceId: string, taskId: string, status: "Scheduled" | "Active" | "Completed" | "Cancelled" = "Scheduled") {
  const start = new Date("2030-01-01T13:00:00.000Z");
  const end = new Date("2030-01-01T14:00:00.000Z");
  return await db.workBlock.create({
    data: {
      workspaceId,
      taskId,
      title: `Block for ${taskId}`,
      status,
      scheduledStartAt: start,
      scheduledEndAt: end,
      trigger: "manual",
    },
  });
}

describe("PUT /api/work-blocks/:workBlockId/schedule", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("reschedules a Scheduled work block to a new window and persists trigger=manual", async () => {
    const { workspaceId } = await seedWorkspace("Work block reschedule");
    const { taskId } = await seedTask(workspaceId, { title: "Reschedule me" });
    const block = await seedWorkBlock(workspaceId, taskId, "Scheduled");

    const newStart = "2030-02-15T09:00:00.000Z";
    const newEnd = "2030-02-15T10:00:00.000Z";
    const res = await app().request(`http://local/api/work-blocks/${block.id}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledStartAt: newStart, scheduledEndAt: newEnd }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workBlockId: string; taskId: string };
    expect(body.workBlockId).toBe(block.id);
    expect(body.taskId).toBe(taskId);

    const stored = await db.workBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(stored.scheduledStartAt.toISOString()).toBe(newStart);
    expect(stored.scheduledEndAt.toISOString()).toBe(newEnd);
    expect(stored.trigger).toBe("manual");
  });

  it("rejects rescheduling an Active work block with 400", async () => {
    const { workspaceId } = await seedWorkspace("Work block active reschedule");
    const { taskId } = await seedTask(workspaceId, { title: "Active block" });
    const block = await seedWorkBlock(workspaceId, taskId, "Active");

    const res = await app().request(`http://local/api/work-blocks/${block.id}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: "2030-02-15T09:00:00.000Z",
        scheduledEndAt: "2030-02-15T10:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);

    // Block remains unchanged.
    const stored = await db.workBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(stored.scheduledStartAt.toISOString()).toBe("2030-01-01T13:00:00.000Z");
    expect(stored.scheduledEndAt.toISOString()).toBe("2030-01-01T14:00:00.000Z");
  });

  it("rejects rescheduling a Completed work block with 400", async () => {
    const { workspaceId } = await seedWorkspace("Work block completed reschedule");
    const { taskId } = await seedTask(workspaceId, { title: "Completed block" });
    const block = await seedWorkBlock(workspaceId, taskId, "Completed");

    const res = await app().request(`http://local/api/work-blocks/${block.id}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: "2030-02-15T09:00:00.000Z",
        scheduledEndAt: "2030-02-15T10:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("engine layer moveWorkBlock also throws on Active block", async () => {
    const { workspaceId } = await seedWorkspace("Move engine guard");
    const { taskId } = await seedTask(workspaceId, { title: "Active block engine" });
    const block = await seedWorkBlock(workspaceId, taskId, "Active");

    expect(
      moveWorkBlock({
        workBlockId: block.id,
        scheduledStartAt: new Date("2030-02-15T09:00:00.000Z"),
        scheduledEndAt: new Date("2030-02-15T10:00:00.000Z"),
      }),
    ).rejects.toThrow(/Cannot reschedule while a work block is active/);
  });
});

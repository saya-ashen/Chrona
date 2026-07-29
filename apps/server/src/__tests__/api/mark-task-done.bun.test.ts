import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { markTaskDone } from "@chrona/engine/test-support";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// markTaskDone — engine-layer unit for the task-done primitive.
// The HTTP surface POST /api/tasks/:taskId/complete is covered by
// routes/__tests__/task-execution-closure; this file pins the engine
// contract on the bare atomic operation:
//
// - throws if there is no latest run
// - throws if the latest run is not Completed
// - on success: task.status flips to Done and completedAt comes from
//   the run's endedAt
// - on success: a task.done canonical event is emitted with the
//   previous → next status pair
// - on success: blockReason is cleared (Prisma.DbNull)
// - on success with no endedAt: completedAt falls back to "now"

async function seedTaskWithRun(
  workspaceId: string,
  title: string,
  runStatus: "Completed" | "Failed" | "Running" = "Completed",
  endedAt?: Date,
) {
  const { taskId } = await seedTask(workspaceId, { title });
  await db.run.create({
    data: {
      taskId,
      runtimeName: "hermes",
      status: runStatus,
      triggeredBy: "test",
      endedAt: endedAt ?? null,
    },
  });
  return taskId;
}

describe("markTaskDone (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("flips task to Done with completedAt from the latest run's endedAt", async () => {
    const { workspaceId } = await seedWorkspace("Mark task done basic");
    const endedAt = new Date("2030-08-01T12:30:00.000Z");
    const taskId = await seedTaskWithRun(workspaceId, "Done me", "Completed", endedAt);

    const result = await markTaskDone({ taskId });
    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("Done");
    expect(task.completedAt?.toISOString()).toBe(endedAt.toISOString());
    expect(task.blockReason).toBeNull();
  });

  it("emits a task.done event with previous_status → next_status payload", async () => {
    const { workspaceId } = await seedWorkspace("Mark task done event");
    const endedAt = new Date("2030-08-02T10:00:00.000Z");
    const taskId = await seedTaskWithRun(workspaceId, "Event me", "Completed", endedAt);

    // Mark task as Blocked first so the previous_status field has a real value
    await db.task.update({ where: { id: taskId }, data: { status: "Blocked" } });

    await markTaskDone({ taskId });

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.done" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as {
      previous_status: string;
      next_status: string;
      completed_at: string;
    };
    expect(payload.previous_status).toBe("Blocked");
    expect(payload.next_status).toBe("Done");
    expect(payload.completed_at).toBe(endedAt.toISOString());
    expect(events[0].dedupeKey).toBe(`task.done:${taskId}:${endedAt.toISOString()}`);
  });

  it("throws when there is no run for the task", async () => {
    const { workspaceId } = await seedWorkspace("Mark task done no run");
    const { taskId } = await seedTask(workspaceId, { title: "No run" });

    await expect(markTaskDone({ taskId })).rejects.toThrow(/completed run/i);
  });

  it("throws when the latest run is not Completed", async () => {
    const { workspaceId } = await seedWorkspace("Mark task done failed run");
    const taskId = await seedTaskWithRun(workspaceId, "Failed run", "Failed");

    await expect(markTaskDone({ taskId })).rejects.toThrow(/completed run/i);
  });

  it("uses the latest run when multiple exist (chronological by createdAt desc)", async () => {
    const { workspaceId } = await seedWorkspace("Mark task done multiple runs");
    const { taskId } = await seedTask(workspaceId, { title: "Multi run" });

    // older run (Failed)
    await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        status: "Failed",
        triggeredBy: "test",
        endedAt: new Date("2029-01-01T00:00:00.000Z"),
      },
    });
    // newer run (Completed) — this one wins
    const newerEnd = new Date("2030-08-15T15:00:00.000Z");
    await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        status: "Completed",
        triggeredBy: "test",
        endedAt: newerEnd,
      },
    });

    await markTaskDone({ taskId });

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("Done");
    expect(task.completedAt?.toISOString()).toBe(newerEnd.toISOString());
  });

  it("falls back to 'now' for completedAt when the latest run has no endedAt", async () => {
    const { workspaceId } = await seedWorkspace("Mark task done null endedAt");
    const taskId = await seedTaskWithRun(workspaceId, "Null end", "Completed");

    const before = Date.now();
    await markTaskDone({ taskId });
    const after = Date.now();

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.status).toBe("Done");
    expect(task.completedAt).toBeInstanceOf(Date);
    const ts = task.completedAt?.getTime() ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

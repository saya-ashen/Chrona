import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { acceptTaskResult } from "@chrona/engine/modules/tasks/accept-task-result";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// acceptTaskResult — engine-layer unit for the task-result-accept
// primitive. The HTTP surface POST /api/tasks/:taskId/result/accept is
// covered by routes/__tests__/task-execution-closure; this file pins
// the engine contract on the bare atomic operation:
//
// - throws if there is no latest run
// - throws if the latest run is not Completed
// - on success: closes the task to Done, clears task blockers, emits a
//   task.result_accepted event with the accepted run id and timestamp,
//   rebuilds projections, and publishes a workspace-updated event for
//   consumers (engine-level pub/sub only — the actual subscriber
//   behavior is covered by the projection integration tests)

async function seedTaskWithRun(
  workspaceId: string,
  title: string,
  runStatus: "Completed" | "Failed" | "Running" = "Completed",
) {
  const { taskId } = await seedTask(workspaceId, { title });
  await db.run.create({
    data: {
      taskId,
      runtimeName: "hermes",
      status: runStatus,
      triggeredBy: "test",
      endedAt: runStatus === "Completed" ? new Date() : null,
    },
  });
  return taskId;
}

describe("acceptTaskResult (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("closes the task and emits a task.result_accepted event with the latest run id", async () => {
    const { workspaceId } = await seedWorkspace("Accept result basic");
    const taskId = await seedTaskWithRun(workspaceId, "Accept me", "Completed");
    const run = await db.run.findFirstOrThrow({ where: { taskId } });

    const result = await acceptTaskResult({ taskId });
    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);
    expect(result.runId).toBe(run.id);

    const acceptedTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(acceptedTask.status).toBe("Done");
    expect(acceptedTask.completedAt).toEqual(run.endedAt);

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.result_accepted" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].runId).toBe(run.id);
    expect(events[0].dedupeKey).toBe(`task.result_accepted:${taskId}:${run.id}`);

    const payload = events[0].payload as {
      accepted_run_id: string;
      accepted_at: string;
    };
    expect(payload.accepted_run_id).toBe(run.id);
    expect(payload.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("throws when there is no run for the task", async () => {
    const { workspaceId } = await seedWorkspace("Accept result no run");
    const { taskId } = await seedTask(workspaceId, { title: "No run" });

    await expect(acceptTaskResult({ taskId })).rejects.toThrow(/completed run/i);
  });

  it("throws when the latest run is Failed", async () => {
    const { workspaceId } = await seedWorkspace("Accept result failed run");
    const taskId = await seedTaskWithRun(workspaceId, "Failed run", "Failed");

    await expect(acceptTaskResult({ taskId })).rejects.toThrow(/completed run/i);
  });

  it("throws when the latest run is still Running", async () => {
    const { workspaceId } = await seedWorkspace("Accept result running run");
    const taskId = await seedTaskWithRun(workspaceId, "Running run", "Running");

    await expect(acceptTaskResult({ taskId })).rejects.toThrow(/completed run/i);
  });

  it("uses the latest (most recent) run when multiple exist", async () => {
    const { workspaceId } = await seedWorkspace("Accept result multiple runs");
    const { taskId } = await seedTask(workspaceId, { title: "Multi run accept" });

    // older failed run
    await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        status: "Failed",
        triggeredBy: "test",
        endedAt: new Date("2029-01-01T00:00:00.000Z"),
      },
    });
    // newer completed run
    const newer = await db.run.create({
      data: {
        taskId,
        runtimeName: "hermes",
        status: "Completed",
        triggeredBy: "test",
        endedAt: new Date(),
      },
    });

    const result = await acceptTaskResult({ taskId });
    expect(result.runId).toBe(newer.id);

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.result_accepted" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].runId).toBe(newer.id);
  });
});

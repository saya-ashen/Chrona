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
// - on success: records review acceptance independently from execution/task
//   lifecycle, emits a task.result_accepted event with the accepted run id
//   and timestamp, and publishes a workspace-updated event for consumers.
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

  it("records result review acceptance without changing execution completion state", async () => {
    const { workspaceId } = await seedWorkspace("Accept result basic");
    const taskId = await seedTaskWithRun(workspaceId, "Accept me", "Completed");
    const run = await db.run.findFirstOrThrow({ where: { taskId } });
    await db.task.update({ where: { id: taskId }, data: { status: "Completed" } });

    const result = await acceptTaskResult({ taskId });
    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);
    expect(result.runId).toBe(run.id);
    expect(result.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const acceptedTask = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(acceptedTask.status).toBe("Done");

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
    expect(payload.accepted_at).toBe(result.acceptedAt);
  });

  it("is idempotent for the same completed run", async () => {
    const { workspaceId } = await seedWorkspace("Accept result replay");
    const taskId = await seedTaskWithRun(workspaceId, "Accept twice", "Completed");
    const first = await acceptTaskResult({ taskId });
    const second = await acceptTaskResult({ taskId });

    expect(second).toEqual(first);
    expect(await db.event.count({ where: { taskId, eventType: "task.result_accepted" } })).toBe(1);
  });

  it("throws when there is no run for the task", async () => {
    const { workspaceId } = await seedWorkspace("Accept result no run");
    const { taskId } = await seedTask(workspaceId, { title: "No run" });

    await expect(acceptTaskResult({ taskId })).rejects.toThrow(/completed run/i);
  });

  it("creates reviewable Workbench candidates for Goal-owned accepted results", async () => {
    const { workspaceId } = await seedWorkspace("Goal result inbox");
    const taskId = await seedTaskWithRun(workspaceId, "Goal deliverable");
    const goal = await db.goal.create({ data: { workspaceId, title: "Durable outcome", successCriteria: [], status: "Active" } });
    await db.task.update({ where: { id: taskId }, data: { goalId: goal.id } });
    const run = await db.run.findFirstOrThrow({ where: { taskId }, orderBy: { createdAt: "desc" } });
    await db.artifact.create({ data: { workspaceId, taskId, runId: run.id, type: "report", title: "Goal report", uri: "generated://goal-report.md", contentPreview: "Accepted Goal evidence" } });

    await acceptTaskResult({ taskId });

    expect(await db.goalInboxCandidate.count({ where: { goalId: goal.id, sourceRunId: run.id, status: "Pending" } })).toBe(1);
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

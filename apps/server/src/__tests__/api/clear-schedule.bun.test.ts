import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { clearSchedule } from "@chrona/engine/modules/scheduling/clear-schedule";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// clearSchedule — engine-layer unit for the schedule-clear primitive.
// The HTTP surface DELETE /api/tasks/:taskId/schedule is covered by
// task-workflow; this file pins the engine contract on the bare
// atomic operation:
//
// - dueAt is nulled on the task row
// - the most recent Scheduled/Active work block is deleted
// - Completed/Cancelled blocks are NOT touched
// - a task.unscheduled event is emitted with the previous dueAt and
//   scheduled times recorded in the payload
// - clear on a task with no schedule is a no-op (still emits the event
//   with null previous_* fields)

const OLD_DUE = new Date("2030-07-01T17:00:00.000Z");

describe("clearSchedule (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("nulls dueAt and deletes the most recent Scheduled work block", async () => {
    const { workspaceId } = await seedWorkspace("Clear schedule");
    const { taskId } = await seedTask(workspaceId, { title: "Clear me", dueAt: OLD_DUE });

    const start = new Date("2030-07-01T09:00:00.000Z");
    const end = new Date("2030-07-01T10:00:00.000Z");
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Old block",
        status: "Scheduled",
        scheduledStartAt: start,
        scheduledEndAt: end,
        trigger: "manual",
      },
    });

    const result = await clearSchedule({ taskId });
    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.dueAt).toBeNull();

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(0);
  });

  it("preserves Completed work blocks and only clears the Scheduled/Active one", async () => {
    const { workspaceId } = await seedWorkspace("Clear schedule preserves completed");
    const { taskId } = await seedTask(workspaceId, { title: "Mixed block statuses" });

    const completedStart = new Date("2029-12-01T09:00:00.000Z");
    const completedEnd = new Date("2029-12-01T10:00:00.000Z");
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Completed block",
        status: "Completed",
        scheduledStartAt: completedStart,
        scheduledEndAt: completedEnd,
        trigger: "manual",
      },
    });

    const scheduledStart = new Date("2030-07-01T09:00:00.000Z");
    const scheduledEnd = new Date("2030-07-01T10:00:00.000Z");
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Scheduled block",
        status: "Scheduled",
        scheduledStartAt: scheduledStart,
        scheduledEndAt: scheduledEnd,
        trigger: "manual",
      },
    });

    await clearSchedule({ taskId });

    const blocks = await db.workBlock.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("Completed");
    expect(blocks[0].scheduledStartAt.toISOString()).toBe(completedStart.toISOString());
  });

  it("emits a task.unscheduled event with the previous dueAt and block window", async () => {
    const { workspaceId } = await seedWorkspace("Clear schedule event payload");
    const { taskId } = await seedTask(workspaceId, { title: "Clear event", dueAt: OLD_DUE });

    const start = new Date("2030-07-01T09:00:00.000Z");
    const end = new Date("2030-07-01T10:00:00.000Z");
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Block",
        status: "Scheduled",
        scheduledStartAt: start,
        scheduledEndAt: end,
        trigger: "manual",
      },
    });

    await clearSchedule({ taskId });

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.unscheduled" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as {
      previous_due_at: string | null;
      previous_scheduled_start_at: string | null;
      previous_scheduled_end_at: string | null;
    };
    expect(payload.previous_due_at).toBe(OLD_DUE.toISOString());
    expect(payload.previous_scheduled_start_at).toBe(start.toISOString());
    expect(payload.previous_scheduled_end_at).toBe(end.toISOString());
  });

  it("clear on a task with no schedule is a no-op for blocks but still emits the event", async () => {
    const { workspaceId } = await seedWorkspace("Clear schedule noop");
    const { taskId } = await seedTask(workspaceId, { title: "Nothing to clear" });

    await clearSchedule({ taskId });

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.dueAt).toBeNull();

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(0);

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.unscheduled" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as {
      previous_due_at: string | null;
      previous_scheduled_start_at: string | null;
      previous_scheduled_end_at: string | null;
    };
    expect(payload.previous_due_at).toBeNull();
    expect(payload.previous_scheduled_start_at).toBeNull();
    expect(payload.previous_scheduled_end_at).toBeNull();
  });
});

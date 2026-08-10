import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { applySchedule } from "@chrona/engine/test-support";
import { resetTestDb, seedTask, seedWorkspace } from "../bun-test-helpers";

// applySchedule — engine-layer unit for the schedule-application
// primitive. The HTTP surface is covered by task-workflow /
// schedule-proposal-workflow; this file pins the engine contract on
// the bare atomic operation:
//
// - dueAt is persisted on the task row even when no window is given
// - a Scheduled work block exists → its window is updated in place
//   and trigger is set by source (ai → scheduled, human → manual)
// - no Scheduled block exists → a fresh block is created
// - an Active block prevents scheduling (state machine guard)
// - importedCalendarEvent rows cause apply to persist only dueAt
//   (external tasks own their own schedule)
// - a task.schedule_changed canonical event is emitted

const PROPOSAL_START = new Date("2030-06-01T09:00:00.000Z");
const PROPOSAL_END = new Date("2030-06-01T10:00:00.000Z");
const PROPOSAL_DUE = new Date("2030-06-01T17:00:00.000Z");

describe("applySchedule (engine)", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("with a window and no existing block creates a fresh Scheduled work block", async () => {
    const { workspaceId } = await seedWorkspace("Apply schedule fresh");
    const { taskId } = await seedTask(workspaceId, { title: "Apply fresh" });

    const result = await applySchedule({
      taskId,
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
      scheduleSource: "ai",
    });
    expect(result.taskId).toBe(taskId);
    expect(result.workspaceId).toBe(workspaceId);

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.dueAt?.toISOString()).toBe(PROPOSAL_DUE.toISOString());

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("Scheduled");
    expect(blocks[0].scheduledStartAt.toISOString()).toBe(PROPOSAL_START.toISOString());
    expect(blocks[0].scheduledEndAt.toISOString()).toBe(PROPOSAL_END.toISOString());
    expect(blocks[0].trigger).toBe("scheduled");
  });

  it("with a human source and no existing block sets trigger=manual", async () => {
    const { workspaceId } = await seedWorkspace("Apply schedule human");
    const { taskId } = await seedTask(workspaceId, { title: "Apply human" });

    await applySchedule({
      taskId,
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
      scheduleSource: "human",
    });

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].trigger).toBe("manual");
  });

  it("with a window and an existing Scheduled block updates it in place", async () => {
    const { workspaceId } = await seedWorkspace("Apply schedule update");
    const { taskId } = await seedTask(workspaceId, { title: "Apply update" });

    const oldStart = new Date("2030-01-10T08:00:00.000Z");
    const oldEnd = new Date("2030-01-10T09:00:00.000Z");
    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Existing",
        status: "Scheduled",
        scheduledStartAt: oldStart,
        scheduledEndAt: oldEnd,
        trigger: "manual",
      },
    });

    await applySchedule({
      taskId,
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
      scheduleSource: "ai",
    });

    const blocks = await db.workBlock.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].scheduledStartAt.toISOString()).toBe(PROPOSAL_START.toISOString());
    expect(blocks[0].scheduledEndAt.toISOString()).toBe(PROPOSAL_END.toISOString());
    expect(blocks[0].trigger).toBe("scheduled");
  });

  it("with an Active block already present throws (state machine guard)", async () => {
    const { workspaceId } = await seedWorkspace("Apply schedule active guard");
    const { taskId } = await seedTask(workspaceId, { title: "Apply active guard" });

    await db.workBlock.create({
      data: {
        workspaceId,
        taskId,
        title: "Active block",
        status: "Active",
        scheduledStartAt: PROPOSAL_START,
        scheduledEndAt: PROPOSAL_END,
        trigger: "manual",
      },
    });

    await expect(
      applySchedule({
        taskId,
        dueAt: null,
        scheduledStartAt: PROPOSAL_START,
        scheduledEndAt: PROPOSAL_END,
        scheduleSource: "ai",
      }),
    ).rejects.toThrow(/active/i);

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(1);
  });

  it("dueAt-only apply (no window) persists dueAt and emits the change event", async () => {
    const { workspaceId } = await seedWorkspace("Apply dueAt only");
    const { taskId } = await seedTask(workspaceId, { title: "Apply due only" });

    await applySchedule({
      taskId,
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduleSource: "human",
    });

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.dueAt?.toISOString()).toBe(PROPOSAL_DUE.toISOString());

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(0);

    const events = await db.event.findMany({
      where: { taskId, eventType: "task.schedule_changed" },
    });
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { due_at: string | null };
    expect(payload.due_at).toBe(PROPOSAL_DUE.toISOString());
  });

  it("external-calendar-managed task: apply persists only dueAt and does NOT create a block", async () => {
    const { workspaceId } = await seedWorkspace("Apply external calendar");
    const { taskId } = await seedTask(workspaceId, { title: "Apply external" });

    // A task with an ImportedCalendarEvent row is treated as externally
    // managed: applySchedule must persist only dueAt and skip the
    // work-block window path so the calendar source stays the authority
    // for the per-occurrence schedule.
    const source = await db.calendarSource.create({
      data: {
        workspaceId,
        name: "External test source",
        sourceUrl: "https://example.com/cal.ics",
        redactedUrlLabel: "example.com/cal.ics",
        color: "#888888",
      },
    });
    await db.importedCalendarEvent.create({
      data: {
        workspaceId,
        calendarSourceId: source.id,
        taskId,
        externalUid: `ext-${taskId}`,
        dedupeKey: `ext-${taskId}`,
        title: "External occurrence",
        startsAt: PROPOSAL_START,
        endsAt: PROPOSAL_END,
      },
    });

    await applySchedule({
      taskId,
      dueAt: PROPOSAL_DUE,
      scheduledStartAt: PROPOSAL_START,
      scheduledEndAt: PROPOSAL_END,
      scheduleSource: "ai",
    });

    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.dueAt?.toISOString()).toBe(PROPOSAL_DUE.toISOString());

    const blocks = await db.workBlock.findMany({ where: { taskId } });
    expect(blocks).toHaveLength(0);
  });
});

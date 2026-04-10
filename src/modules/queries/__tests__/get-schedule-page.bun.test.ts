import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getSchedulePage } from "@/modules/queries/get-schedule-page";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("getSchedulePage", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("groups scheduled work, unscheduled work, pending AI proposals, and risks", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Query",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const otherWorkspace = await db.workspace.create({
      data: {
        name: "Other Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const scheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Ship projection cleanup",
        status: "Ready",
        priority: "High",
        ownerType: "human",
        dueAt: new Date("2026-04-16T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-16T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-16T11:00:00.000Z"),
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
      },
    });

    const unscheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Queue follow-up docs",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
        scheduleStatus: "Unscheduled",
      },
    });

    const riskTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recover overdue adapter run",
        status: "Blocked",
        priority: "Urgent",
        ownerType: "human",
        dueAt: new Date("2026-04-15T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
        scheduleStatus: "Overdue",
        scheduleSource: "human",
      },
    });

    await db.taskProjection.createMany({
      data: [
        {
          taskId: scheduledTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Ready",
          displayState: "Ready",
          dueAt: new Date("2026-04-16T18:00:00.000Z"),
          scheduledStartAt: new Date("2026-04-16T09:00:00.000Z"),
          scheduledEndAt: new Date("2026-04-16T11:00:00.000Z"),
          scheduleStatus: "Scheduled",
          scheduleSource: "human",
          scheduleProposalCount: 0,
          lastActivityAt: new Date("2026-04-15T12:00:00.000Z"),
        },
        {
          taskId: unscheduledTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Ready",
          displayState: "Ready",
          scheduleStatus: "Unscheduled",
          scheduleProposalCount: 1,
          actionRequired: "Schedule task",
          lastActivityAt: new Date("2026-04-15T12:05:00.000Z"),
        },
        {
          taskId: riskTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Blocked",
          displayState: "Attention Needed",
          dueAt: new Date("2026-04-15T18:00:00.000Z"),
          scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
          scheduledEndAt: new Date("2026-04-15T11:00:00.000Z"),
          scheduleStatus: "Overdue",
          scheduleSource: "human",
          scheduleProposalCount: 0,
          actionRequired: "Reschedule task",
          lastActivityAt: new Date("2026-04-15T12:10:00.000Z"),
        },
      ],
    });

    await db.scheduleProposal.create({
      data: {
        workspaceId: workspace.id,
        taskId: unscheduledTask.id,
        source: "ai",
        status: "Pending",
        proposedBy: "planner-agent",
        summary: "Plan this for tomorrow morning",
        dueAt: new Date("2026-04-17T18:00:00.000Z"),
        scheduledStartAt: new Date("2026-04-17T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-17T10:30:00.000Z"),
      },
    });

    const hiddenTask = await db.task.create({
      data: {
        workspaceId: otherWorkspace.id,
        title: "Hidden schedule item",
        status: "Ready",
        priority: "Low",
        ownerType: "human",
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: new Date("2026-04-18T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-18T10:00:00.000Z"),
      },
    });

    await db.taskProjection.create({
      data: {
        taskId: hiddenTask.id,
        workspaceId: otherWorkspace.id,
        persistedStatus: "Ready",
        displayState: "Ready",
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
      },
    });

    const page = await getSchedulePage(workspace.id);

    expect(page.scheduled).toHaveLength(2);
    expect(page.scheduled.find((item) => item.taskId === scheduledTask.id)).toMatchObject({
      taskId: scheduledTask.id,
      title: "Ship projection cleanup",
      priority: "High",
      persistedStatus: "Ready",
      scheduleStatus: "Scheduled",
    });
    expect(page.scheduled.find((item) => item.taskId === riskTask.id)).toMatchObject({
      taskId: riskTask.id,
      title: "Recover overdue adapter run",
      priority: "Urgent",
      scheduleStatus: "Overdue",
    });

    expect(page.unscheduled).toHaveLength(1);
    expect(page.unscheduled[0]).toMatchObject({
      taskId: unscheduledTask.id,
      title: "Queue follow-up docs",
      priority: "Medium",
      actionRequired: "Schedule task",
    });

    expect(page.risks).toHaveLength(1);
    expect(page.risks[0]).toMatchObject({
      taskId: riskTask.id,
      title: "Recover overdue adapter run",
      priority: "Urgent",
      scheduleStatus: "Overdue",
      actionRequired: "Reschedule task",
    });

    expect(page.proposals).toHaveLength(1);
    expect(page.proposals[0]).toMatchObject({
      taskId: unscheduledTask.id,
      title: "Queue follow-up docs",
      priority: "Medium",
      source: "ai",
      summary: "Plan this for tomorrow morning",
    });

    expect(page.summary).toEqual({
      scheduledCount: 2,
      unscheduledCount: 1,
      proposalCount: 1,
      riskCount: 1,
    });

    expect(page.listItems).toHaveLength(3);
    expect(page.listItems.map((item) => item.taskId).sort()).toEqual(
      [riskTask.id, scheduledTask.id, unscheduledTask.id].sort(),
    );
    expect(page.listItems.find((item) => item.taskId === unscheduledTask.id)).toMatchObject({
      scheduleStatus: "Unscheduled",
      actionRequired: "Schedule task",
      scheduleProposalCount: 1,
    });

    expect(page.scheduled.some((item) => item.taskId === hiddenTask.id)).toBe(false);
    expect(page.listItems.some((item) => item.taskId === hiddenTask.id)).toBe(false);
  });
});

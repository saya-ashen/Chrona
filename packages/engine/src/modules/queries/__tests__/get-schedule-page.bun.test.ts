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
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const addMinutes = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000);
    const todayNine = addMinutes(startOfToday, 9 * 60);
    const todayEleven = addMinutes(startOfToday, 11 * 60);
    const todayThirteen = addMinutes(startOfToday, 13 * 60);
    const todayFourteen = addMinutes(startOfToday, 14 * 60);
    const todayEighteen = addMinutes(startOfToday, 18 * 60);
    const todayTwenty = addMinutes(startOfToday, 20 * 60);
    const tomorrowNine = addMinutes(startOfToday, (24 + 9) * 60);
    const tomorrowEleven = addMinutes(startOfToday, (24 + 11) * 60);
    const dayAfterTomorrowNine = addMinutes(startOfToday, (48 + 9) * 60);
    const dayAfterTomorrowTenThirty = addMinutes(startOfToday, (48 + 10) * 60 + 30);
    const dayAfterTomorrowEighteen = addMinutes(startOfToday, (48 + 18) * 60);

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
        dueAt: dayAfterTomorrowEighteen,
        scheduledStartAt: tomorrowNine,
        scheduledEndAt: tomorrowEleven,
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
        dueAt: todayTwenty,
        scheduleStatus: "Unscheduled",
      },
    });

    const subtask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: unscheduledTask.id,
        title: "Draft the follow-up outline",
        status: "Ready",
        priority: "Low",
        ownerType: "human",
        scheduleStatus: "Unscheduled",
      },
    });

    await db.taskDependency.create({
      data: {
        workspaceId: workspace.id,
        taskId: subtask.id,
        dependsOnTaskId: unscheduledTask.id,
        dependencyType: "child_of",
      },
    });

    const reviewTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Review launch checklist",
        status: "Ready",
        priority: "Low",
        ownerType: "human",
        scheduledStartAt: todayThirteen,
        scheduledEndAt: todayFourteen,
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
      },
    });

    const riskTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recover overdue adapter run",
        status: "Blocked",
        priority: "Urgent",
        ownerType: "human",
        dueAt: todayEighteen,
        scheduledStartAt: todayNine,
        scheduledEndAt: todayEleven,
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
          dueAt: dayAfterTomorrowEighteen,
          scheduledStartAt: tomorrowNine,
          scheduledEndAt: tomorrowEleven,
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
          dueAt: todayTwenty,
          scheduleStatus: "Unscheduled",
          scheduleProposalCount: 1,
          actionRequired: "Schedule task",
          lastActivityAt: new Date("2026-04-15T12:05:00.000Z"),
        },
        {
          taskId: subtask.id,
          workspaceId: workspace.id,
          persistedStatus: "Ready",
          displayState: "Ready",
          scheduleStatus: "Unscheduled",
          scheduleProposalCount: 0,
          lastActivityAt: new Date("2026-04-15T12:06:00.000Z"),
        },
        {
          taskId: reviewTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Ready",
          displayState: "Ready",
          scheduledStartAt: todayThirteen,
          scheduledEndAt: todayFourteen,
          scheduleStatus: "Scheduled",
          scheduleSource: "human",
          scheduleProposalCount: 0,
          lastActivityAt: new Date("2026-04-15T12:20:00.000Z"),
        },
        {
          taskId: riskTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Blocked",
          displayState: "Attention Needed",
          dueAt: todayEighteen,
          scheduledStartAt: todayNine,
          scheduledEndAt: todayEleven,
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
        dueAt: dayAfterTomorrowEighteen,
        scheduledStartAt: dayAfterTomorrowNine,
        scheduledEndAt: dayAfterTomorrowTenThirty,
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

    expect(page.scheduled).toHaveLength(3);
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
    expect(page.scheduled.find((item) => item.taskId === reviewTask.id)).toMatchObject({
      taskId: reviewTask.id,
      title: "Review launch checklist",
      priority: "Low",
      scheduleStatus: "Scheduled",
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
      scheduledCount: 3,
      unscheduledCount: 1,
      proposalCount: 1,
      riskCount: 1,
    });
    expect(page.planningSummary).toEqual({
      scheduledMinutes: 300,
      runnableQueueCount: 1,
      conflictCount: 0,
      overloadedDayCount: 0,
      proposalCount: 1,
      riskCount: 1,
      todayLoadMinutes: 180,
      overdueCount: 1,
      atRiskCount: 0,
      readyToScheduleCount: 1,
      autoRunnableCount: 1,
      waitingOnUserCount: 1,
      dueSoonUnscheduledCount: 1,
      largestIdleWindowMinutes: 120,
      overloadedMinutes: 0,
    });
    expect(page.focusZones).toEqual([
      {
        dayKey: startOfToday.toISOString().slice(0, 10),
        totalMinutes: 180,
        deepWorkMinutes: 120,
        fragmentedMinutes: 60,
        riskLevel: "high",
      },
      {
        dayKey: addMinutes(startOfToday, 24 * 60).toISOString().slice(0, 10),
        totalMinutes: 120,
        deepWorkMinutes: 120,
        fragmentedMinutes: 0,
        riskLevel: "low",
      },
    ]);
    expect(page.automationCandidates).toEqual([
      {
        taskId: unscheduledTask.id,
        kind: "auto_schedule",
        reason: "Due soon and already has a pending proposal.",
        priority: "high",
      },
      {
        taskId: riskTask.id,
        kind: "remind",
        reason: "Risk item is waiting on user rescheduling.",
        priority: "high",
      },
      {
        taskId: reviewTask.id,
        kind: "auto_run",
        reason: "Scheduled task is ready to run automatically.",
        priority: "medium",
        scheduledStartAt: todayThirteen,
        executionMode: "none",
        sessionStrategy: "per_subtask",
        readyNodeIds: [],
      },
      {
        taskId: scheduledTask.id,
        kind: "auto_run",
        reason: "Scheduled task is ready to run automatically.",
        priority: "high",
        scheduledStartAt: tomorrowNine,
        executionMode: "none",
        sessionStrategy: "per_subtask",
        readyNodeIds: [],
      },
    ]);

    expect(page.listItems).toHaveLength(5);
    expect(page.listItems.map((item) => item.taskId).sort()).toEqual(
      [reviewTask.id, riskTask.id, scheduledTask.id, subtask.id, unscheduledTask.id].sort(),
    );
    expect(page.listItems.some((item) => item.taskId === subtask.id)).toBe(true);
    expect(page.listItems.find((item) => item.taskId === unscheduledTask.id)).toMatchObject({
      scheduleStatus: "Unscheduled",
      actionRequired: "Schedule task",
      scheduleProposalCount: 1,
    });

    expect(page.scheduled.some((item) => item.taskId === hiddenTask.id)).toBe(false);
    expect(page.listItems.some((item) => item.taskId === hiddenTask.id)).toBe(false);
  });
});

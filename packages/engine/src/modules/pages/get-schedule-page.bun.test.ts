import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import { getSchedulePage } from "@/modules/pages/get-schedule-page";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
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
    await resetDb();
  });

  it("exposes configured AI clients without a task adapter catalog", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "OMP runtime default",
        status: "Active",
      },
    });
    const ompClient = await db.aiClient.create({
      data: {
        name: "OMP",
        type: "omp",
        config: {},
        isDefault: true,
        enabled: true,
      },
    });

    try {
      const page = await getSchedulePage(workspace.id);

      expect(page).not.toHaveProperty("defaultExecutionRuntime");
      expect(page).not.toHaveProperty("executionRuntimes");
      expect(page.availableAiClients).toEqual([
        {
          id: ompClient.id,
          name: "OMP",
          type: "omp",
          isDefault: true,
          enabled: true,
        },
      ]);
    } finally {
      await db.aiClient.delete({ where: { id: ompClient.id } });
    }
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
      },
    });

    const otherWorkspace = await db.workspace.create({
      data: {
        name: "Other Workspace",
        status: "Active",
      },
    });

    const scheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Ship projection cleanup",
        status: "Ready",
        priority: "High",
        dueAt: dayAfterTomorrowEighteen,
        executionConfig: {},
      },
    });

    const unscheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Queue follow-up docs",
        status: "Ready",
        priority: "Medium",
        dueAt: todayTwenty,
        executionConfig: {},
      },
    });

    const completedUnscheduledTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Completed task should leave queue",
        status: "Completed",
        priority: "Medium",
        completedAt: new Date("2026-04-15T12:30:00.000Z"),
        executionConfig: {},
      },
    });

    const subtask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: unscheduledTask.id,
        title: "Draft the follow-up outline",
        status: "Ready",
        priority: "Low",
        executionConfig: {},
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
        executionConfig: {},
      },
    });

    const riskTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recover overdue adapter run",
        status: "Blocked",
        priority: "Urgent",
        dueAt: todayEighteen,
        executionConfig: {},
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
          taskId: completedUnscheduledTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Completed",
          displayState: "Completed",
          dueAt: todayTwenty,
          scheduleStatus: "Unscheduled",
          scheduleProposalCount: 0,
          lastActivityAt: new Date("2026-04-15T12:30:00.000Z"),
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
        executionConfig: {},
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

    expect(page.unscheduled.map((item) => item.taskId)).toEqual([unscheduledTask.id]);
    expect(page.unscheduled.some((item) => item.taskId === completedUnscheduledTask.id)).toBe(false);
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

    expect(page.listItems).toHaveLength(6);
    expect(page.listItems.map((item) => item.taskId).sort((left, right) => left.localeCompare(right))).toEqual(
      [
        completedUnscheduledTask.id,
        reviewTask.id,
        riskTask.id,
        scheduledTask.id,
        subtask.id,
        unscheduledTask.id,
      ].sort((left, right) => left.localeCompare(right)),
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

  it("returns lightweight saved plan snapshots without first-paint graph payload", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Plan Snapshot",
        status: "Active",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Planned task",
        status: "Ready",
        priority: "High",
        executionConfig: {},
      },
    });

    await db.taskProjection.create({
      data: {
        taskId: task.id,
        workspaceId: workspace.id,
        persistedStatus: "Ready",
        displayState: "Ready",
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: new Date("2026-04-15T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-04-15T10:00:00.000Z"),
      },
    });
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      status: "draft",
      prompt: "plan this task",
      summary: "Plan summary",
      generatedBy: "generate-task-plan",
      compiledPlan: {
        id: "compiled-plan-1",
        editablePlanId: "plan-1",
        sourceVersion: 1,
        title: "Plan title",
        goal: "Plan goal",
        assumptions: [],
        nodes: [],
        edges: [],
        entryNodeIds: [],
        terminalNodeIds: [],
        topologicalOrder: [],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    const page = await getSchedulePage(workspace.id);
    const item = page.listItems.find((entry) => entry.taskId === task.id);

    expect(item?.savedPlan).toEqual({
      id: "plan-1",
      status: "draft",
      revision: 1,
      summary: "Plan summary",
      updatedAt: expect.any(String),
      generatedBy: "AI",
    });
    expect(JSON.stringify(item?.savedPlan)).not.toContain("blueprint");
    expect(JSON.stringify(item?.savedPlan)).not.toContain("compiledPlan");
    expect(JSON.stringify(item?.savedPlan)).not.toContain("effectivePlan");
  });

  it("includes occurrence-scoped saved plans on work block scheduled items", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Occurrence plan workspace", status: "Active" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recurring planning",
        status: "Ready",
        priority: "Medium",
        executionConfig: {},
        kind: "recurring",
        recurrenceRule: "FREQ=DAILY;COUNT=2",
      },
    });
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        recurrenceKey: "2026-06-04T14:00:00.000Z",
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-04T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-04T15:00:00.000Z"),
        trigger: "manual",
      },
    });
    await db.taskProjection.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        persistedStatus: "Ready",
        displayState: "Ready",
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: new Date("2026-06-04T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-04T15:00:00.000Z"),
      },
    });
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: workBlock.id,
      status: "accepted",
      prompt: "plan this occurrence",
      summary: "Occurrence plan summary",
      generatedBy: "generate-task-plan",
      compiledPlan: {
        id: "compiled-occurrence-plan-1",
        editablePlanId: "occurrence-plan-1",
        sourceVersion: 1,
        title: "Occurrence plan title",
        goal: "Occurrence plan goal",
        assumptions: [],
        nodes: [],
        edges: [],
        entryNodeIds: [],
        terminalNodeIds: [],
        topologicalOrder: [],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    const page = await getSchedulePage(workspace.id);
    const item = page.scheduled.find((entry) => (entry as { workBlockId?: string | null }).workBlockId === workBlock.id);

    expect(item?.taskId).toBe(task.id);
    expect(item?.savedPlan).toEqual({
      id: "occurrence-plan-1",
      status: "accepted",
      revision: 1,
      summary: "Occurrence plan summary",
      updatedAt: expect.any(String),
      generatedBy: "AI",
    });
    expect(item?.aiPlanGenerationStatus).toBe("accepted");
  });

  it("keeps a completed scheduled task in the timeline after projection rebuild", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Completed Schedule Visibility",
        status: "Active",
      },
    });

    const scheduledStartAt = new Date("2026-05-27T09:00:00.000Z");
    const scheduledEndAt = new Date("2026-05-27T10:00:00.000Z");
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Completed task should remain visible",
        status: "Completed",
        priority: "High",
        completedAt: new Date("2026-05-27T10:05:00.000Z"),
        executionConfig: {},
      },
    });

    await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Completed",
        scheduledStartAt,
        scheduledEndAt,
        completedAt: new Date("2026-05-27T10:05:00.000Z"),
        trigger: "manual",
      },
    });

    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: "Completed",
        triggeredBy: "schedule",
        startedAt: scheduledStartAt,
        endedAt: new Date("2026-05-27T10:05:00.000Z"),
      },
    });

    await rebuildTaskProjection(task.id);

    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.scheduledStartAt).toEqual(scheduledStartAt);
    expect(projection.scheduledEndAt).toEqual(scheduledEndAt);
    expect(projection.scheduleStatus).toBe("Completed");

    const page = await getSchedulePage(workspace.id);
    expect(page.scheduled.find((item) => item.taskId === task.id)).toMatchObject({
      taskId: task.id,
      title: "Completed task should remain visible",
      persistedStatus: "Completed",
      scheduleStatus: "Completed",
      scheduledStartAt,
      scheduledEndAt,
    });
  });

  it("includes scheduled work blocks even when task projection has no scheduled window", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Recurring Workspace", status: "Active" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recurring imported task",
        status: "Cancelled",
        priority: "Medium",
        executionConfig: {},
        recurrenceRule: "FREQ=DAILY",
        seriesExternalUid: "series-1",
      },
    });
    await db.taskProjection.create({
      data: {
        taskId: task.id,
        workspaceId: workspace.id,
        persistedStatus: "Cancelled",
        scheduleProposalCount: 0,
      },
    });
    const workBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-04T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-04T15:00:00.000Z"),
        trigger: "manual",
      },
    });

    const page = await getSchedulePage(workspace.id);

    expect(page.scheduled).toEqual([
      expect.objectContaining({
        taskId: task.id,
        workBlockId: workBlock.id,
        title: task.title,
        scheduledStartAt: new Date("2026-06-04T14:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-04T15:00:00.000Z"),
      }),
    ]);
  });
});

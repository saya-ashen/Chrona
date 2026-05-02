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

describe("getSchedulePage runnable state", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("exposes runnable summaries for scheduled and unscheduled tasks", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Schedule Runnable State",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    futureStart.setHours(9, 0, 0, 0);
    const futureEnd = new Date(futureStart.getTime() + 60 * 60 * 1000);

    const readyTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Configured task",
        description: "Has the minimum runnable config",
        status: "Ready",
        priority: "High",
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: {},
        runtimeInputVersion: "1",
        runtimeModel: "gpt-5.4",
        prompt: "Execute the configured task",
        runtimeConfig: { temperature: 0.2, sessionStrategy: "per_subtask" },
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: futureStart,
        scheduledEndAt: futureEnd,
      },
    });

    const draftTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Missing prompt task",
        description: "Still needs instructions",
        status: "Draft",
        priority: "Medium",
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: {},
        runtimeInputVersion: "1",
        runtimeModel: "gpt-5.4",
        prompt: null,
        runtimeConfig: {},
        scheduleStatus: "Unscheduled",
      },
    });

    const childDraft = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: draftTask.id,
        title: "Child task should stay out of queue",
        description: "Inherited from decomposition",
        status: "Draft",
        priority: "Low",
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: {},
        runtimeInputVersion: "1",
        runtimeModel: "gpt-5.4",
        prompt: null,
        runtimeConfig: {},
        scheduleStatus: "Unscheduled",
      },
    });

    await db.taskDependency.create({
      data: {
        workspaceId: workspace.id,
        taskId: childDraft.id,
        dependsOnTaskId: draftTask.id,
        dependencyType: "child_of",
      },
    });

    await db.taskProjection.createMany({
      data: [
        {
          taskId: readyTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Ready",
          displayState: "Ready",
          scheduleStatus: "Scheduled",
          scheduleSource: "human",
          scheduledStartAt: futureStart,
          scheduledEndAt: futureEnd,
          lastActivityAt: new Date("2026-04-15T12:00:00.000Z"),
        },
        {
          taskId: draftTask.id,
          workspaceId: workspace.id,
          persistedStatus: "Draft",
          displayState: "Draft",
          scheduleStatus: "Unscheduled",
          scheduleProposalCount: 0,
          actionRequired: "Configure task",
          lastActivityAt: new Date("2026-04-15T12:05:00.000Z"),
        },
        {
          taskId: childDraft.id,
          workspaceId: workspace.id,
          persistedStatus: "Draft",
          displayState: "Draft",
          scheduleStatus: "Unscheduled",
          scheduleProposalCount: 0,
          actionRequired: "Configure task",
          lastActivityAt: new Date("2026-04-15T12:06:00.000Z"),
        },
      ],
    });

    const page = await getSchedulePage(workspace.id);

    expect(page.scheduled[0]).toMatchObject({
      taskId: readyTask.id,
      runtimeModel: "gpt-5.4",
      prompt: "Execute the configured task",
      isRunnable: true,
      runnabilityState: "ready_to_run",
      runnabilitySummary: "Ready to run",
    });

    expect(page.unscheduled).toHaveLength(1);
    expect(page.unscheduled[0]).toMatchObject({
      taskId: draftTask.id,
      runtimeModel: "gpt-5.4",
      prompt: null,
      isRunnable: true,
      runnabilityState: "ready_to_run",
      runnabilitySummary: "Ready to run",
    });
    expect(page.unscheduled.some((item) => item.taskId === childDraft.id)).toBe(false);
    expect(page.listItems.some((item) => item.taskId === childDraft.id)).toBe(true);

    expect(page.automationCandidates).toEqual([
      {
        taskId: readyTask.id,
        kind: "auto_run",
        reason: "Scheduled task is ready to run automatically.",
        priority: "high",
        scheduledStartAt: futureStart,
        executionMode: "none",
        sessionStrategy: "per_subtask",
        readyNodeIds: [],
      },
    ]);
  });
});

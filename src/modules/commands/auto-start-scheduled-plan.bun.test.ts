import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

const startRunMock = mock();
mock.module("@/modules/commands/start-run", () => ({
  startRun: startRunMock,
}));

const { autoStartScheduledPlanTasks } = await import("@/modules/commands/auto-start-scheduled-plan");

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
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("auto-start-scheduled-plan", () => {
  beforeEach(async () => {
    startRunMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("starts due scheduled parent task and materializes automatic child-task nodes into separate sessions", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Auto Start Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const parentTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Ship weekly plan",
        status: "Ready",
        priority: "High",
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: { model: "gpt-5.4", prompt: "Run parent task" },
        runtimeInputVersion: "openclaw-legacy-v1",
        runtimeModel: "gpt-5.4",
        prompt: "Run parent task",
        runtimeConfig: { sessionStrategy: "per_subtask" },
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: new Date(Date.now() - 5 * 60_000),
        scheduledEndAt: new Date(Date.now() + 55 * 60_000),
      },
    });

    await db.taskProjection.create({
      data: {
        taskId: parentTask.id,
        workspaceId: workspace.id,
        persistedStatus: "Ready",
        displayState: "Ready",
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: parentTask.scheduledStartAt,
        scheduledEndAt: parentTask.scheduledEndAt,
      },
    });

    await saveTaskPlanGraph({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      plan: {
        id: "graph-1",
        taskId: parentTask.id,
        status: "accepted",
        revision: 1,
        source: "ai",
        generatedBy: "planner",
        prompt: null,
        summary: "accepted graph",
        changeSummary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: "node-auto-1",
            type: "step",
            title: "Collect evidence",
            objective: "Collect evidence",
            description: null,
            status: "pending",
            phase: null,
            estimatedMinutes: 20,
            priority: "High",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            linkedTaskId: null,
            completionSummary: null,
            metadata: { materialization: "child_task" },
          },
          {
            id: "node-manual-1",
            type: "user_input",
            title: "Confirm direction",
            objective: "Confirm direction",
            description: null,
            status: "pending",
            phase: null,
            estimatedMinutes: 5,
            priority: "Medium",
            executionMode: "manual",
            requiresHumanInput: true,
            requiresHumanApproval: false,
            autoRunnable: false,
            blockingReason: "needs_user_input",
            linkedTaskId: null,
            completionSummary: null,
            metadata: null,
          },
        ],
        edges: [],
      },
    });

    startRunMock.mockResolvedValue({
      taskId: parentTask.id,
      workspaceId: workspace.id,
      runId: "run-parent",
      runtimeRunRef: "runtime-parent",
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.startedTaskIds).toContain(parentTask.id);
    expect(startRunMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    const childTasks = await db.task.findMany({
      where: { parentTaskId: parentTask.id },
      orderBy: { createdAt: "asc" },
      include: { sessions: true },
    });

    expect(childTasks).toHaveLength(1);
    expect(childTasks[0]?.title).toBe("Collect evidence");
    expect(childTasks[0]?.sessions.length).toBe(1);
  });
});

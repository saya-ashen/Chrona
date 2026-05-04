import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

const startPlanExecutionMock = mock();
mock.module("@/modules/plan-execution", () => ({
  startPlanExecution: startPlanExecutionMock,
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
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createWorkspace() {
  return db.workspace.create({
    data: {
      name: "Auto Start Workspace",
      status: "Active",
      defaultRuntime: "openclaw",
    },
  });
}

async function createDueTask(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const task = await db.task.create({
    data: {
      workspaceId,
      title: "Due scheduled task",
      status: "Ready",
      priority: "High",
      ownerType: "human",
      runtimeAdapterKey: "openclaw",
      runtimeInput: { model: "gpt-5.4", prompt: "Run task" },
      runtimeInputVersion: "openclaw-legacy-v1",
      runtimeModel: "gpt-5.4",
      prompt: "Run task",
      runtimeConfig: { sessionStrategy: "per_subtask" },
      scheduleStatus: "Scheduled",
      scheduleSource: "human",
      scheduledStartAt: new Date(Date.now() - 5 * 60_000),
      scheduledEndAt: new Date(Date.now() + 55 * 60_000),
      ...overrides,
    },
  });

  await db.workBlock.create({
    data: {
      workspaceId,
      taskId: task.id,
      title: task.title,
      status: "Scheduled",
      scheduledStartAt: (overrides.scheduledStartAt as Date) ?? new Date(Date.now() - 5 * 60_000),
      scheduledEndAt: (overrides.scheduledEndAt as Date) ?? new Date(Date.now() + 55 * 60_000),
      trigger: "scheduled",
    },
  });

  return task;
}

describe("auto-start-scheduled-plan", () => {
  beforeEach(async () => {
    startPlanExecutionMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("starts due scheduled parent task and materializes automatic child-task nodes into separate sessions", async () => {
    const workspace = await createWorkspace();

    const parentTask = await createDueTask(workspace.id, { title: "Ship weekly plan" });

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
            type: "task",
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
            type: "checkpoint",
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

    startPlanExecutionMock.mockResolvedValue({
      taskId: parentTask.id,
      planId: "graph-1",
      mainSessionId: "session-1",
      status: "running",
      currentNodeId: "node-auto-1",
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Execution started",
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started.length).toBeGreaterThanOrEqual(1);
    expect(result.started[0]?.taskId).toBe(parentTask.id);
    expect(result.started[0]?.runId).toBe("graph-1");
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);

    const childTasks = await db.task.findMany({
      where: { parentTaskId: parentTask.id },
      orderBy: { createdAt: "asc" },
      include: { sessions: true },
    });

    expect(childTasks).toHaveLength(0);
  });

  it("calls startPlanExecution with trigger scheduler", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id);

    startPlanExecutionMock.mockResolvedValue({
      taskId: "task-1",
      planId: "plan-1",
      mainSessionId: "session-1",
      status: "running",
      currentNodeId: "node-1",
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started",
    });

    await autoStartScheduledPlanTasks({ now: new Date() });

    expect(startPlanExecutionMock).toHaveBeenCalledTimes(1);
    const callArgs = startPlanExecutionMock.mock.calls[0]?.[0];
    expect(callArgs?.trigger).toBe("scheduler");
  });

  it("skips tasks that are not yet due", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id, {
      scheduledStartAt: new Date(Date.now() + 60 * 60_000),
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });

  it("skips tasks that already have an active run", async () => {
    const workspace = await createWorkspace();
    const task = await createDueTask(workspace.id);

    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: "Running",
        triggeredBy: "user",
      },
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.taskId).toBe(task.id);
    expect(result.skipped[0]?.reason).toBe("already_running");
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });

  it("skips tasks with non-Scheduled scheduleStatus", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id, { scheduleStatus: "Unscheduled" });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });

  it("skips tasks without a runtime adapter key", async () => {
    const workspace = await createWorkspace();
    const task = await createDueTask(workspace.id, {
      runtimeAdapterKey: null,
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.taskId).toBe(task.id);
    expect(result.skipped[0]?.reason).toBe("no_runtime_config");
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });

  it("writes task.auto_start.skipped events for skipped tasks", async () => {
    const workspace = await createWorkspace();
    const task = await createDueTask(workspace.id);

    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: "Running",
        triggeredBy: "user",
      },
    });

    await autoStartScheduledPlanTasks({ now: new Date() });

    const skipEvents = await db.event.findMany({
      where: {
        taskId: task.id,
        eventType: "task.auto_start.skipped",
      },
    });

    expect(skipEvents.length).toBe(1);
    expect(skipEvents[0]?.actorType).toBe("system");
    expect(skipEvents[0]?.actorId).toBe("auto-start-scheduler");
    expect(skipEvents[0]?.source).toBe("scheduler");
    const payload = skipEvents[0]?.payload as Record<string, unknown> | undefined;
    expect(payload?.reason).toBe("already_running");
  });

  it("does not let one task failure block other due tasks", async () => {
    const workspace = await createWorkspace();
    const task1 = await createDueTask(workspace.id, { title: "Task 1" });
    const task2 = await createDueTask(workspace.id, { title: "Task 2" });

    let callCount = 0;
    startPlanExecutionMock.mockImplementation(async (input: { taskId: string }) => {
      callCount++;
      if (input.taskId === task1.id) {
        throw new Error("Runtime unavailable");
      }
      return {
        taskId: input.taskId,
        planId: `plan-${input.taskId}`,
        mainSessionId: `session-${input.taskId}`,
        status: "running" as const,
        currentNodeId: null,
        executedNodeIds: [],
        waitingNodeIds: [],
        blockedNodeIds: [],
        message: "Started",
      };
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.failed.length).toBe(1);
    expect(result.failed[0]?.taskId).toBe(task1.id);
    expect(result.failed[0]?.error).toBe("Runtime unavailable");
    expect(result.started.length).toBe(1);
    expect(result.started[0]?.taskId).toBe(task2.id);
    expect(callCount).toBe(2);
  });

  it("returns structured result with correct now timestamp", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id);

    startPlanExecutionMock.mockResolvedValue({
      taskId: "task-1",
      planId: "plan-1",
      mainSessionId: "session-1",
      status: "running" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started",
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.now).toBeString();
    expect(result.started.length).toBe(1);
    expect(result.skipped.length).toBe(0);
    expect(result.failed.length).toBe(0);
  });

  it("returns empty results when no due tasks match query", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id, { status: "Done" });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });

  it("activates work block on auto-start", async () => {
    const workspace = await createWorkspace();
    const task = await createDueTask(workspace.id);

    startPlanExecutionMock.mockResolvedValue({
      taskId: task.id,
      planId: "plan-1",
      mainSessionId: "session-1",
      status: "running" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started",
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started.length).toBe(1);
    expect(result.started[0].taskId).toBe(task.id);
    expect(result.started[0].workBlockId).toBeString();

    const updatedBlock = await db.workBlock.findFirst({ where: { taskId: task.id } });
    expect(updatedBlock?.status).toBe("Active");
    expect(updatedBlock?.startedAt).not.toBeNull();
  });

  it("skips tasks without active work blocks", async () => {
    const workspace = await createWorkspace();
    await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "No work block task",
        status: "Ready",
        priority: "Medium",
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: { model: "gpt-5.4", prompt: "Run" },
        runtimeInputVersion: "openclaw-legacy-v1",
        runtimeModel: "gpt-5.4",
        prompt: "Run",
        runtimeConfig: { sessionStrategy: "per_subtask" },
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: new Date(Date.now() - 5 * 60_000),
        scheduledEndAt: new Date(Date.now() + 55 * 60_000),
      },
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });

  it("skips work blocks whose task status is not eligible", async () => {
    const workspace = await createWorkspace();
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Running task",
        status: "Running",
        priority: "High",
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: { model: "gpt-5.4", prompt: "Run" },
        runtimeInputVersion: "openclaw-legacy-v1",
        runtimeModel: "gpt-5.4",
        prompt: "Run",
        runtimeConfig: { sessionStrategy: "per_subtask" },
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: new Date(Date.now() - 5 * 60_000),
        scheduledEndAt: new Date(Date.now() + 55 * 60_000),
      },
    });

    await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date(Date.now() - 5 * 60_000),
        scheduledEndAt: new Date(Date.now() + 55 * 60_000),
        trigger: "scheduled",
      },
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startPlanExecutionMock).not.toHaveBeenCalled();
  });
});

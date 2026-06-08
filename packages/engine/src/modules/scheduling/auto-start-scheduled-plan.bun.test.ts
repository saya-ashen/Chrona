import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/persistence/compiled-plan-store";
import { taskScheduling } from "@/modules/scheduling/task-scheduling";
import { createTask } from "@/modules/tasks/create-task";

const startMock = mock();
const dispatchMock = mock();
const syncRuntimeResultMock = mock();
mock.module("@/modules/plan-execution", () => ({
  taskPlanExecution: {
    start: startMock,
    dispatch: dispatchMock,
    syncRuntimeResult: syncRuntimeResultMock,
  },
}));

const { autoStartScheduledPlanTasks } = await import("@/modules/scheduling/auto-start-scheduled-plan");

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
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
      defaultRuntime: "hermes",
    },
  });
}

async function createDueTask(workspaceId: string, overrides: Record<string, unknown> = {}) {
  const {
    scheduledStartAt,
    scheduledEndAt,
    workBlockStatus,
    acceptedPlan = true,
    ...taskOverrides
  } = overrides as {
    scheduledStartAt?: Date;
    scheduledEndAt?: Date;
    workBlockStatus?: "Scheduled" | "Active" | "Completed" | "Cancelled";
    acceptedPlan?: boolean;
  } & Record<string, unknown>;

  const task = await db.task.create({
    data: {
      workspaceId,
      title: "Due scheduled task",
      status: "Ready",
      priority: "High",
      autoExecute: true,
      executionRuntime: "hermes",
      executionConfig: { prompt: "Run task", sessionStrategy: "per_subtask" },
      ...taskOverrides,
    },
  });

  const workBlock = await db.workBlock.create({
    data: {
      workspaceId,
      taskId: task.id,
      title: task.title,
      status: workBlockStatus ?? "Scheduled",
      scheduledStartAt: scheduledStartAt ?? new Date(Date.now() - 5 * 60_000),
      scheduledEndAt: scheduledEndAt ?? new Date(Date.now() + 55 * 60_000),
      trigger: "scheduled",
    },
  });

  if (acceptedPlan) {
    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      status: "accepted",
      summary: "accepted graph",
      generatedBy: "auto-start-test",
      compiledPlan: {
        id: `graph-${task.id}`,
        editablePlanId: `ep-${task.id}`,
        sourceVersion: 1,
        title: task.title,
        goal: task.title,
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
  }

  return { task, workBlock };
}

describe("auto-start-scheduled-plan", () => {
  beforeEach(async () => {
    startMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    mock.restore();
  });

  it("skips due auto-execute tasks without an accepted plan", async () => {
    const workspace = await createWorkspace();
    const { task } = await createDueTask(workspace.id, { acceptedPlan: false });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      taskId: task.id,
      reason: "no_accepted_plan",
    });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts due scheduled parent task and materializes automatic child-task nodes into separate sessions", async () => {
    const workspace = await createWorkspace();

    const { task: parentTask, workBlock } = await createDueTask(workspace.id, { title: "Ship weekly plan" });

    await db.taskProjection.create({
      data: {
        taskId: parentTask.id,
        workspaceId: workspace.id,
        persistedStatus: "Ready",
        displayState: "Ready",
        scheduleStatus: "Scheduled",
        scheduleSource: "human",
        scheduledStartAt: workBlock.scheduledStartAt,
        scheduledEndAt: workBlock.scheduledEndAt,
      },
    });

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      summary: "accepted graph",
      generatedBy: "planner",
      compiledPlan: {
        id: "graph-1",
        editablePlanId: "ep-graph-1",
        sourceVersion: 1,
        title: "Ship weekly plan",
        goal: "Ship weekly plan",
        assumptions: [],
        nodes: [
          {
            id: "node-auto-1",
            localId: "node-auto-1",
            type: "task",
            title: "Collect evidence",
            config: { expectedOutput: "Collect evidence" } as import("@chrona/contracts/ai").NodeConfig,
            dependencies: [],
            dependents: [],
            mode: "auto",
            executor: "ai",
          },
          {
            id: "node-manual-1",
            localId: "node-manual-1",
            type: "checkpoint",
            title: "Confirm direction",
            config: {
              checkpointType: "confirm",
              prompt: "Confirm direction",
              required: true,
            } as import("@chrona/contracts/ai").NodeConfig,
            dependencies: [],
            dependents: [],
            mode: "manual",
            executor: "user",
          },
        ],
        edges: [],
        entryNodeIds: ["node-auto-1"],
        terminalNodeIds: ["node-manual-1"],
        topologicalOrder: ["node-auto-1", "node-manual-1"],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    startMock.mockResolvedValue({
      taskId: parentTask.id,
      planId: "ep-graph-1",
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
    expect(result.started[0]?.runId).toBe("ep-graph-1");
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);

    const childTasks = await db.task.findMany({
      where: { parentTaskId: parentTask.id },
      orderBy: { createdAt: "asc" },
      include: { sessions: true },
    });

    expect(childTasks).toHaveLength(0);
  });

  it("starts task execution with trigger scheduler", async () => {
    const workspace = await createWorkspace();
    const { workBlock } = await createDueTask(workspace.id);

    startMock.mockResolvedValue({
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

    expect(startMock).toHaveBeenCalledTimes(1);
    const callArgs = startMock.mock.calls[0]?.[0];
    expect(callArgs?.trigger).toBe("scheduler");
    expect(callArgs?.workBlockId).toBe(workBlock.id);
  });

  it("starts due Draft tasks when runtime config and accepted plan make them runnable", async () => {
    const workspace = await createWorkspace();
    const { task } = await createDueTask(workspace.id, { status: "Draft" });

    startMock.mockResolvedValue({
      taskId: task.id,
      planId: "plan-draft-ready",
      mainSessionId: "session-draft-ready",
      status: "running" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started from draft",
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.taskId).toBe(task.id);
    expect(result.skipped).toEqual([]);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("skips tasks that are not yet due", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id, {
      scheduledStartAt: new Date(Date.now() + 60 * 60_000),
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts tasks whose scheduled start exactly matches now", async () => {
    const now = new Date("2026-05-28T10:00:00.000Z");
    const workspace = await createWorkspace();
    const { task } = await createDueTask(workspace.id, {
      scheduledStartAt: now,
      scheduledEndAt: new Date(now.getTime() + 60 * 60_000),
    });

    startMock.mockResolvedValue({
      taskId: task.id,
      planId: "plan-boundary",
      mainSessionId: "session-boundary",
      status: "running" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started at boundary",
    });

    const result = await autoStartScheduledPlanTasks({ now });

    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.taskId).toBe(task.id);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("processes overdue backlog from oldest scheduled start first", async () => {
    const now = new Date("2026-05-28T10:00:00.000Z");
    const workspace = await createWorkspace();
    const { task: newerTask } = await createDueTask(workspace.id, {
      title: "Newer backlog task",
      scheduledStartAt: new Date(now.getTime() - 5 * 60_000),
    });
    const { task: olderTask } = await createDueTask(workspace.id, {
      title: "Older backlog task",
      scheduledStartAt: new Date(now.getTime() - 60 * 60_000),
    });

    startMock.mockImplementation(async (input: { taskId: string }) => ({
      taskId: input.taskId,
      planId: `plan-${input.taskId}`,
      mainSessionId: `session-${input.taskId}`,
      status: "running" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started backlog task",
    }));

    const result = await autoStartScheduledPlanTasks({ now });

    expect(result.started.map((started) => started.taskId)).toEqual([olderTask.id, newerTask.id]);
    expect(startMock.mock.calls.map((call) => call[0]?.taskId)).toEqual([olderTask.id, newerTask.id]);
  });

  it("ignores due scheduled tasks that did not opt in to auto execution", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id, { autoExecute: false });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("skips tasks that already have an active run", async () => {
    const workspace = await createWorkspace();
    const { task } = await createDueTask(workspace.id);

    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: "Running",
        triggeredBy: "user",
      },
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0]?.taskId).toBe(task.id);
    expect(result.skipped[0]?.reason).toBe("already_running");
    expect(startMock).not.toHaveBeenCalled();
  });

  it("ignores work blocks that are not scheduled", async () => {
    const workspace = await createWorkspace();
    await createDueTask(workspace.id, { workBlockStatus: "Completed" });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("writes task.auto_start.skipped events for skipped tasks", async () => {
    const workspace = await createWorkspace();
    const { task } = await createDueTask(workspace.id);

    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
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
    const { task: task1 } = await createDueTask(workspace.id, { title: "Task 1" });
    const { task: task2 } = await createDueTask(workspace.id, { title: "Task 2" });

    let callCount = 0;
    startMock.mockImplementation(async (input: { taskId: string }) => {
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

    startMock.mockResolvedValue({
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
    expect(startMock).not.toHaveBeenCalled();
  });

  it("activates work block on auto-start", async () => {
    const workspace = await createWorkspace();
    const { task } = await createDueTask(workspace.id);

    startMock.mockResolvedValue({
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

  it("auto-starts a created task after scheduling through the scheduling module", async () => {
    const now = new Date();
    const workspace = await createWorkspace();
    const created = await createTask({
      workspaceId: workspace.id,
      title: "Scheduled from create flow",
      priority: "High",
      autoExecute: true,
      executionRuntime: "hermes",
      executionConfig: { prompt: "Run task", sessionStrategy: "per_subtask" },
    });

    await taskScheduling.apply({
      taskId: created.taskId,
      dueAt: null,
      scheduledStartAt: new Date(now.getTime() - 60_000),
      scheduledEndAt: new Date(now.getTime() + 30 * 60_000),
      scheduleSource: "human",
    });
    const createdTask = await db.task.findUniqueOrThrow({ where: { id: created.taskId } });
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: created.taskId,
      status: "accepted",
      summary: "accepted graph",
      generatedBy: "auto-start-test",
      compiledPlan: {
        id: `graph-${created.taskId}`,
        editablePlanId: `ep-${created.taskId}`,
        sourceVersion: 1,
        title: createdTask.title,
        goal: createdTask.title,
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

    startMock.mockResolvedValue({
      taskId: created.taskId,
      planId: "plan-created-flow",
      mainSessionId: "session-created-flow",
      status: "running" as const,
      currentNodeId: null,
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      message: "Started from scheduler facade",
    });

    const result = await taskScheduling.autoStartScheduledPlans();

    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.taskId).toBe(created.taskId);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock.mock.calls[0]?.[0]).toMatchObject({
      taskId: created.taskId,
      trigger: "scheduler",
    });

    const block = await db.workBlock.findFirst({ where: { taskId: created.taskId } });
    expect(block?.status).toBe("Active");
    expect(block?.startedAt).not.toBeNull();
  });

  it("ignores tasks without work blocks", async () => {
    const workspace = await createWorkspace();
    await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "No work block task",
        status: "Ready",
        priority: "Medium",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run", sessionStrategy: "per_subtask" },
      },
    });

    const result = await autoStartScheduledPlanTasks({ now: new Date() });

    expect(result.started).toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("skips work blocks whose task status is not eligible", async () => {
    const workspace = await createWorkspace();
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Running task",
        status: "Running",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run", sessionStrategy: "per_subtask" },
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
    expect(startMock).not.toHaveBeenCalled();
  });
});

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import type { NodeConfig } from "@chrona/contracts/ai";

const startRunMock = mock();
mock.module("@/modules/commands/start-run", () => ({
  startRun: startRunMock,
}));

const { progressAcceptedTaskPlan } = await import("@/modules/commands/progress-accepted-task-plan");

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

describe("progress-accepted-task-plan", () => {
  beforeEach(async () => {
    startRunMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("materializes and starts only newly ready downstream nodes", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Progress Workspace", status: "Active", defaultRuntime: "openclaw" },
    });

    const parentTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: { model: "gpt-5.4", prompt: "Parent" },
        runtimeInputVersion: "openclaw-legacy-v1",
        runtimeModel: "gpt-5.4",
        prompt: "Parent",
        runtimeConfig: { sessionStrategy: "per_subtask" },
      },
    });

    const finishedChild = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: parentTask.id,
        title: "Step A",
        status: TaskStatus.Completed,
        priority: TaskPriority.Medium,
        ownerType: "human",
        runtimeAdapterKey: "openclaw",
        runtimeInput: { model: "gpt-5.4", prompt: "A" },
        runtimeInputVersion: "openclaw-legacy-v1",
        runtimeModel: "gpt-5.4",
        prompt: "A",
      },
    });

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      summary: "Sequential plan",
      generatedBy: "planner",
      compiledPlan: {
        id: "plan-sequential",
        editablePlanId: "ep-plan-seq",
        sourceVersion: 1,
        title: "Sequential plan",
        goal: "Build sequential stuff",
        assumptions: [],
        nodes: [
          {
            id: "a",
            localId: "a",
            type: "task",
            title: "Step A",
            config: { expectedOutput: "Do A" } as NodeConfig,
            dependencies: [],
            dependents: ["b"],
            mode: "auto",
            executor: "ai",
            linkedTaskId: finishedChild.id,
          },
          {
            id: "b",
            localId: "b",
            type: "task",
            title: "Step B",
            config: { expectedOutput: "Do B" } as NodeConfig,
            dependencies: ["a"],
            dependents: ["c"],
            mode: "auto",
            executor: "ai",
          },
          {
            id: "c",
            localId: "c",
            type: "task",
            title: "Step C",
            config: { expectedOutput: "Do C" } as NodeConfig,
            dependencies: ["b"],
            dependents: [],
            mode: "auto",
            executor: "ai",
          },
        ],
        edges: [
          { id: "e1", from: "a", to: "b" },
          { id: "e2", from: "b", to: "c" },
        ],
        entryNodeIds: ["a"],
        terminalNodeIds: ["c"],
        topologicalOrder: ["a", "b", "c"],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    startRunMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
      taskId,
      workspaceId: workspace.id,
      runId: `run-${taskId}`,
      runtimeRunRef: `runtime-${taskId}`,
    }));

    const result = await progressAcceptedTaskPlan({ parentTaskId: parentTask.id });

    expect(result.startedTaskIds).toHaveLength(1);
    expect(startRunMock).toHaveBeenCalledTimes(1);

    const childTasks = await db.task.findMany({
      where: { parentTaskId: parentTask.id },
      orderBy: { createdAt: "asc" },
    });

    expect(childTasks).toHaveLength(3);
    expect(childTasks[1]?.title).toBe("Step B");
    expect(childTasks[2]?.title).toBe("Step C");
    expect(startRunMock).toHaveBeenCalledWith({ taskId: childTasks[1]!.id });
    expect(startRunMock.mock.calls.some(([arg]) => arg.taskId === childTasks[2]!.id)).toBe(false);
  });

  it("marks the parent task completed when every accepted-plan node is done", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Progress Workspace", status: "Active", defaultRuntime: "openclaw" },
    });

    const parentTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      summary: "Finished plan",
      generatedBy: "planner",
      compiledPlan: {
        id: "plan-finished",
        editablePlanId: "ep-plan-finished",
        sourceVersion: 1,
        title: "Finished plan",
        goal: "Finished",
        assumptions: [],
        nodes: [
          {
            id: "a",
            localId: "a",
            type: "task",
            title: "Step A",
            config: { expectedOutput: "Do A" } as NodeConfig,
            dependencies: [],
            dependents: [],
            mode: "auto",
            executor: "ai",
          },
        ],
        edges: [],
        entryNodeIds: ["a"],
        terminalNodeIds: ["a"],
        topologicalOrder: ["a"],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    const result = await progressAcceptedTaskPlan({ parentTaskId: parentTask.id });
    const updatedParent = await db.task.findUniqueOrThrow({ where: { id: parentTask.id } });

    expect(result.parentCompleted).toBe(true);
    expect(updatedParent.status).toBe(TaskStatus.Completed);
    expect(updatedParent.completedAt).not.toBeNull();
  });
});

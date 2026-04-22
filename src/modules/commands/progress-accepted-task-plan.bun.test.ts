import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";

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

    await saveTaskPlanGraph({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      source: "ai",
      generatedBy: "planner",
      prompt: "plan",
      plan: {
        version: "task-plan-graph@1",
        summary: "Sequential plan",
        nodes: [
          {
            id: "a",
            type: "step",
            title: "Step A",
            objective: "Do A",
            description: null,
            status: "done",
            phase: null,
            estimatedMinutes: 10,
            priority: "Medium",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            linkedTaskId: finishedChild.id,
            completionSummary: "A done",
            metadata: null,
          },
          {
            id: "b",
            type: "step",
            title: "Step B",
            objective: "Do B",
            description: null,
            status: "pending",
            phase: null,
            estimatedMinutes: 10,
            priority: "Medium",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            linkedTaskId: null,
            completionSummary: null,
            metadata: null,
          },
          {
            id: "c",
            type: "step",
            title: "Step C",
            objective: "Do C",
            description: null,
            status: "pending",
            phase: null,
            estimatedMinutes: 10,
            priority: "Medium",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            linkedTaskId: null,
            completionSummary: null,
            metadata: null,
          },
        ],
        edges: [
          { id: "e1", fromNodeId: "a", toNodeId: "b", type: "depends_on" },
          { id: "e2", fromNodeId: "b", toNodeId: "c", type: "depends_on" },
        ],
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

    await saveTaskPlanGraph({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      source: "ai",
      generatedBy: "planner",
      prompt: "plan",
      plan: {
        version: "task-plan-graph@1",
        summary: "Finished plan",
        nodes: [
          {
            id: "a",
            type: "step",
            title: "Step A",
            objective: "Do A",
            description: null,
            status: "done",
            phase: null,
            estimatedMinutes: 10,
            priority: "Medium",
            executionMode: "automatic",
            requiresHumanInput: false,
            requiresHumanApproval: false,
            autoRunnable: true,
            blockingReason: null,
            linkedTaskId: null,
            completionSummary: "done",
            metadata: null,
          },
        ],
        edges: [],
      },
    });

    const result = await progressAcceptedTaskPlan({ parentTaskId: parentTask.id });
    const updatedParent = await db.task.findUniqueOrThrow({ where: { id: parentTask.id } });

    expect(result.parentCompleted).toBe(true);
    expect(updatedParent.status).toBe(TaskStatus.Completed);
    expect(updatedParent.completedAt).not.toBeNull();
  });
});

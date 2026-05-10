import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskDependencyType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import type { NodeConfig } from "@chrona/contracts/ai";

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

describe("materialize-task-plan", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("creates child tasks for child_task nodes and wires blocks dependencies", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Materialize Plan",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const parentTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent graph task",
        status: "Ready",
        priority: "High",
        executionRuntime: "openclaw",
        executionConfig: {},
      },
    });

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      prompt: "materialize executable nodes",
      summary: "Two executable nodes",
      generatedBy: "graph-planner",
      compiledPlan: {
        id: "plan-materialize-1",
        editablePlanId: "ep-plan-materialize-1",
        sourceVersion: 2,
        title: "Materialize executable nodes",
        goal: "Two executable nodes",
        assumptions: [],
        nodes: [
          {
            id: "node-1",
            localId: "node-1",
            type: "task",
            title: "Collect evidence",
            description: "Gather all materials first",
            config: { expectedOutput: "Prepare source inputs" } as NodeConfig,
            dependencies: [],
            dependents: ["node-2"],
            mode: "auto",
            executor: "ai",
            priority: "High",
            estimatedMinutes: 20,
          },
          {
            id: "node-2",
            localId: "node-2",
            type: "task",
            title: "Draft summary",
            description: "Create a concise summary",
            config: { expectedOutput: "Write the first draft" } as NodeConfig,
            dependencies: ["node-1"],
            dependents: [],
            mode: "auto",
            executor: "ai",
            priority: "Medium",
            estimatedMinutes: 40,
          },
          {
            id: "node-3",
            localId: "node-3",
            type: "checkpoint",
            title: "Review result",
            config: { checkpointType: "approve" } as NodeConfig,
            dependencies: [],
            dependents: [],
            mode: "manual",
            executor: "user",
            priority: "Medium",
            estimatedMinutes: 10,
          },
        ],
        edges: [
          {
            id: "edge-1",
            from: "node-1",
            to: "node-2",
          },
        ],
        entryNodeIds: ["node-1", "node-3"],
        terminalNodeIds: ["node-2", "node-3"],
        topologicalOrder: ["node-1", "node-2", "node-3"],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    const result = await materializeTaskPlan({ taskId: parentTask.id });

    expect(result.createdTaskIds).toHaveLength(2);
    expect(result.updatedNodeIds).toEqual(["node-1", "node-2"]);

    const childTasks = await db.task.findMany({
      where: { parentTaskId: parentTask.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, priority: true, description: true },
    });

    expect(childTasks).toHaveLength(2);
    expect(childTasks.map((task) => task.title)).toEqual(["Collect evidence", "Draft summary"]);
    expect(childTasks.map((task) => task.priority)).toEqual(["High", "Medium"]);
    expect(childTasks.map((task) => task.description)).toEqual(["Gather all materials first", "Create a concise summary"]);

    const dependencies = await db.taskDependency.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { taskId: true, dependsOnTaskId: true, dependencyType: true },
    });

    expect(dependencies).toEqual([
      {
        taskId: childTasks[1]!.id,
        dependsOnTaskId: childTasks[0]!.id,
        dependencyType: TaskDependencyType.blocks,
      },
    ]);
  });
});

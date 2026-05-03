import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MemoryScope, MemorySourceType, MemoryStatus, TaskDependencyType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { materializeTaskPlan } from "@/modules/commands/materialize-task-plan";

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
        ownerType: "human",
      },
    });

    await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: parentTask.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
        confidence: 1,
        content: JSON.stringify({
          type: "task_plan_graph_v1",
          status: "accepted",
          revision: 2,
          source: "ai",
          generatedBy: "graph-planner",
          prompt: "materialize executable nodes",
          summary: "Two executable nodes",
          changeSummary: null,
          nodes: [
            {
              id: "node-1",
              type: "task",
              title: "Collect evidence",
              objective: "Prepare source inputs",
              description: "Gather all materials first",
              status: "pending",
              phase: "preparation",
              estimatedMinutes: 20,
              priority: "High",
              executionMode: "child_task",
              linkedTaskId: null,
              completionSummary: null,
              needsUserInput: false,
              metadata: { order: 1 },
            },
            {
              id: "node-2",
              type: "task",
              title: "Draft summary",
              objective: "Write the first draft",
              description: "Create a concise summary",
              status: "pending",
              phase: "execution",
              estimatedMinutes: 40,
              priority: "Medium",
              executionMode: "child_task",
              linkedTaskId: null,
              completionSummary: null,
              needsUserInput: false,
              metadata: { order: 2 },
            },
            {
              id: "node-3",
              type: "checkpoint",
              title: "Review result",
              objective: "Validate the output",
              description: null,
              status: "pending",
              phase: "review",
              estimatedMinutes: 10,
              priority: "Medium",
              executionMode: "manual",
              linkedTaskId: null,
              completionSummary: null,
              needsUserInput: false,
              metadata: { order: 3 },
            },
          ],
          edges: [
            {
              id: "edge-1",
              fromNodeId: "node-1",
              toNodeId: "node-2",
              type: "sequential",
              metadata: null,
            },
          ],
        }),
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

    const activeMemory = await db.memory.findFirstOrThrow({
      where: {
        taskId: parentTask.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
      },
      orderBy: { updatedAt: "desc" },
    });

    const parsed = JSON.parse(activeMemory.content) as {
      nodes: Array<{ id: string; linkedTaskId: string | null }>;
    };

    expect(parsed.nodes.find((node) => node.id === "node-1")?.linkedTaskId).toBe(childTasks[0]!.id);
    expect(parsed.nodes.find((node) => node.id === "node-2")?.linkedTaskId).toBe(childTasks[1]!.id);
    expect(parsed.nodes.find((node) => node.id === "node-3")?.linkedTaskId).toBeNull();
  });
});

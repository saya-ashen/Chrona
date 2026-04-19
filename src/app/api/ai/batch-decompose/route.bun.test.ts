import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MemoryScope, MemorySourceType, MemoryStatus, TaskDependencyType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { POST } from "@/app/api/ai/batch-decompose/route";

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

describe("POST /api/ai/batch-decompose", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("materializes decomposition subtasks through the plan graph and writes linkedTaskId back", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Batch Decompose",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const parent = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/ai/batch-decompose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: parent.id,
          subtasks: [
            {
              title: "New subtask A",
              description: "First replacement",
              priority: "high",
              estimatedMinutes: 30,
              order: 1,
              dependsOnPrevious: false,
            },
            {
              title: "New subtask B",
              description: "Second replacement",
              priority: "medium",
              estimatedMinutes: 45,
              order: 2,
              dependsOnPrevious: true,
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);

    const payload = (await response.json()) as {
      subtasks: Array<{ id: string; title: string; parentTaskId: string | null; priority: string }>;
    };

    expect(payload.subtasks).toHaveLength(2);
    expect(payload.subtasks.map((item) => item.title)).toEqual(["New subtask A", "New subtask B"]);
    expect(payload.subtasks.every((item) => item.parentTaskId === parent.id)).toBe(true);
    expect(payload.subtasks.map((item) => item.priority)).toEqual(["High", "Medium"]);

    const storedSubtasks = await db.task.findMany({
      where: { parentTaskId: parent.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, priority: true },
    });

    expect(storedSubtasks).toHaveLength(2);

    const dependencies = await db.taskDependency.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { taskId: true, dependsOnTaskId: true, dependencyType: true },
    });

    expect(dependencies).toEqual([
      {
        taskId: storedSubtasks[1]!.id,
        dependsOnTaskId: storedSubtasks[0]!.id,
        dependencyType: TaskDependencyType.blocks,
      },
    ]);

    const activeMemory = await db.memory.findFirstOrThrow({
      where: {
        taskId: parent.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
      },
      orderBy: { updatedAt: "desc" },
    });

    const parsed = JSON.parse(activeMemory.content) as {
      type: string;
      nodes: Array<{ title: string; linkedTaskId: string | null; executionMode: string }>;
    };

    expect(parsed.type).toBe("task_plan_graph_v1");
    expect(parsed.nodes.map((node) => node.executionMode)).toEqual(["child_task", "child_task"]);
    expect(parsed.nodes.map((node) => node.linkedTaskId)).toEqual(storedSubtasks.map((task) => task.id));
  });
});

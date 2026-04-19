import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MemoryScope, MemorySourceType, MemoryStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  acceptTaskPlanGraph,
  getAcceptedTaskPlanGraph,
  getLatestTaskPlanGraph,
  taskPlanGraphToDecompositionResult,
} from "@/modules/tasks/task-plan-graph-store";

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

describe("task-plan-graph-store", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("loads only task_plan_graph_v1 memories", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Graph Store",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Graph plan task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
        confidence: 0.7,
        content: JSON.stringify({
          type: "task_plan_graph_v1",
          status: "draft",
          revision: 1,
          source: "ai",
          generatedBy: "graph-store-test",
          prompt: "graph only",
          summary: "One graph node",
          changeSummary: null,
          nodes: [
            {
              id: "node-1",
              type: "step",
              title: "Graph step",
              objective: "Use graph payload only",
              description: null,
              status: "pending",
              phase: "execution",
              estimatedMinutes: 30,
              priority: "High",
              executionMode: "none",
              linkedTaskId: null,
              needsUserInput: false,
              metadata: { order: 1, feasibilityScore: 90, totalEstimatedMinutes: 30, warnings: [] },
            },
          ],
          edges: [],
        }),
      },
    });

    const stored = await getLatestTaskPlanGraph(task.id);

    expect(stored).not.toBeNull();
    expect(stored?.prompt).toBe("graph only");
    expect(stored?.plan.nodes).toHaveLength(1);
    expect(stored?.plan.nodes[0]?.title).toBe("Graph step");
    expect(taskPlanGraphToDecompositionResult(stored!.plan)).toMatchObject({
      subtasks: [
        {
          title: "Graph step",
          estimatedMinutes: 30,
          priority: "High",
          order: 1,
          dependsOnPrevious: false,
        },
      ],
      totalEstimatedMinutes: 30,
      feasibilityScore: 90,
      warnings: [],
    });
  });

  it("accepts a graph plan and surfaces it as the accepted version", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Graph Accept",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Graph plan task",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    const created = await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        scope: MemoryScope.task,
        sourceType: MemorySourceType.agent_inferred,
        status: MemoryStatus.Active,
        confidence: 0.7,
        content: JSON.stringify({
          type: "task_plan_graph_v1",
          status: "draft",
          revision: 3,
          source: "ai",
          generatedBy: "test",
          prompt: "focus on checkpoints",
          summary: "Two-step plan",
          changeSummary: null,
          nodes: [
            {
              id: "node-1",
              type: "step",
              title: "Collect inputs",
              objective: "Gather requirements",
              description: null,
              status: "pending",
              phase: null,
              estimatedMinutes: 15,
              priority: "High",
              executionMode: "none",
              linkedTaskId: null,
              needsUserInput: false,
              metadata: { order: 1 },
            },
          ],
          edges: [],
        }),
      },
    });

    const accepted = await acceptTaskPlanGraph({ planId: created.id, taskId: task.id });
    const storedAccepted = await getAcceptedTaskPlanGraph(task.id);

    expect(accepted.status).toBe("accepted");
    expect(storedAccepted?.id).toBe(created.id);
    expect(storedAccepted?.status).toBe("accepted");
    expect(storedAccepted?.plan.revision).toBe(3);
  });
});

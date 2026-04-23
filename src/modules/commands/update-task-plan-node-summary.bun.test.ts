import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveTaskPlanGraph, getAcceptedTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import { updateTaskPlanNodeSummary } from "@/modules/commands/update-task-plan-node-summary";

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

describe("update-task-plan-node-summary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("updates completionSummary for a specific accepted-plan node", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Summary workspace", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
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
      taskId: task.id,
      status: "accepted",
      source: "ai",
      generatedBy: "planner",
      prompt: "plan",
      plan: {
        id: "plan-summary",
        taskId: task.id,
        status: "accepted",
        revision: 1,
        source: "ai",
        generatedBy: "planner",
        prompt: "plan",
        summary: "Summary plan",
        changeSummary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: "node-1",
            type: "step",
            title: "Step 1",
            objective: "Do step 1",
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
            completionSummary: "Awaiting agent-authored completion summary.",
            metadata: null,
          },
        ],
        edges: [],
      },
    });

    await updateTaskPlanNodeSummary({
      taskId: task.id,
      nodeId: "node-1",
      completionSummary: "Verified result and archived artifacts.",
    });

    const accepted = await getAcceptedTaskPlanGraph(task.id);
    expect(accepted?.plan.nodes[0]?.completionSummary).toBe("Verified result and archived artifacts.");
  });
});

import { beforeEach, describe, expect, it } from "bun:test";
import { RunStatus, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveTaskPlanGraph, getAcceptedTaskPlanGraph } from "@/modules/tasks/task-plan-graph-store";
import { createMockOpenClawAdapter } from "@chrona/openclaw-integration/runtime/mock-adapter";
import { syncRunFromRuntime } from "@/modules/runtime-sync/sync-run";

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

describe("plan node sync on run completion", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks linked plan nodes done and stores a completion summary placeholder when child run completes", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Plan sync workspace",
        defaultRuntime: "openclaw",
        status: "Active",
      },
    });

    const parentTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent task",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const childTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Child node task",
        status: TaskStatus.Running,
        priority: TaskPriority.Medium,
        ownerType: "human",
        parentTaskId: parentTask.id,
      },
    });

    const run = await db.run.create({
      data: {
        taskId: childTask.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_completed_1",
        runtimeSessionRef: "agent:main:dashboard:session_completed_1",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: childTask.id },
      data: { latestRunId: run.id },
    });

    await saveTaskPlanGraph({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      source: "ai",
      generatedBy: "test",
      prompt: "Generate executable graph",
      plan: {
        id: "plan-node-sync",
        taskId: parentTask.id,
        status: "accepted",
        revision: 1,
        source: "ai",
        generatedBy: "test",
        prompt: "Generate executable graph",
        summary: "Test graph",
        changeSummary: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: "node-child",
            type: "task",
            title: "Child node task",
            objective: "Do the child task",
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
            linkedTaskId: childTask.id,
            completionSummary: null,
            metadata: null,
          },
        ],
        edges: [],
      },
    });

    await syncRunFromRuntime({
      runId: run.id,
      adapter: createMockOpenClawAdapter({ fixtureName: "run-completed" }),
    });

    const accepted = await getAcceptedTaskPlanGraph(parentTask.id);
    expect(accepted?.plan.nodes).toHaveLength(1);
    expect(accepted?.plan.nodes[0]).toMatchObject({
      id: "node-child",
      status: "done",
      completionSummary: "Awaiting agent-authored completion summary.",
    });
  });
});



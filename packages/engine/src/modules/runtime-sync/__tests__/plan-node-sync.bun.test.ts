import { beforeEach, describe, expect, it } from "bun:test";
import { RunStatus, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getAcceptedCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { createMockOpenClawAdapter } from "@chrona/openclaw/runtime/mock-adapter";
import { syncRunFromRuntime } from "@/modules/runtime-sync/sync-run";
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

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: parentTask.id,
      status: "accepted",
      summary: "Test graph",
      generatedBy: "test",
      compiledPlan: {
        id: "plan-node-sync",
        editablePlanId: "ep-plan-node-sync",
        sourceVersion: 1,
        title: "Test graph",
        goal: "Test graph",
        assumptions: [],
        nodes: [
          {
            id: "node-child",
            localId: "node-child",
            type: "task",
            title: "Child node task",
            config: { expectedOutput: "Do the child task" } as NodeConfig,
            dependencies: [],
            dependents: [],
            mode: "auto",
            executor: "ai",
            linkedTaskId: childTask.id,
          },
        ],
        edges: [],
        entryNodeIds: ["node-child"],
        terminalNodeIds: ["node-child"],
        topologicalOrder: ["node-child"],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    await syncRunFromRuntime({
      runId: run.id,
      adapter: createMockOpenClawAdapter({ fixtureName: "run-completed" }),
    });

    const accepted = await getAcceptedCompiledPlan(parentTask.id);
    expect(accepted?.compiledPlan.nodes).toHaveLength(1);
    expect(accepted?.compiledPlan.nodes[0]).toMatchObject({
      id: "node-child",
    });
  });
});

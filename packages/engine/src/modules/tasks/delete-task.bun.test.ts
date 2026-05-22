import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { deleteTask } from "./delete-task";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.reconciliationEvent.deleteMany();
  await db.graphMutationRecord.deleteMany();
  await db.graphVersion.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskPlanLayer.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
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
  await db.taskAssistantMessage.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
});

describe("deleteTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("deletes execution and orchestration records for the task tree", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Delete Task", status: "Active", defaultRuntime: "openclaw" },
    });
    const parent = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent",
        executionRuntime: "openclaw",
        executionConfig: {},
        status: "Running",
        priority: "Medium",
      },
    });
    const child = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: parent.id,
        title: "Child",
        executionRuntime: "openclaw",
        executionConfig: {},
        status: "Running",
        priority: "Medium",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: child.id,
        runtimeName: "openclaw",
        runtimeRunRef: "run_child",
        status: "Running",
        triggeredBy: "user",
      },
    });
    await db.runtimeCursor.create({
      data: { runId: run.id, runtimeName: "openclaw" },
    });
    await db.conversationEntry.create({
      data: { runId: run.id, role: "assistant", content: "hello", sequence: 1 },
    });
    await db.toolCallDetail.create({
      data: { runId: run.id, toolName: "shell", status: "completed" },
    });
    await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: child.id,
        title: "Child block",
        status: "Active",
        scheduledStartAt: new Date("2026-05-22T10:00:00.000Z"),
        scheduledEndAt: new Date("2026-05-22T11:00:00.000Z"),
      },
    });
    await db.executionSession.create({
      data: { workspaceId: workspace.id, taskId: child.id, status: "Active", planId: "plan_child" },
    });
    await db.schedulerEvent.create({
      data: { workspaceId: workspace.id, taskId: child.id, eventType: "scheduler.repair" },
    });

    await deleteTask(parent.id);

    expect(await db.task.count()).toBe(0);
    expect(await db.run.count()).toBe(0);
    expect(await db.runtimeCursor.count()).toBe(0);
    expect(await db.conversationEntry.count()).toBe(0);
    expect(await db.toolCallDetail.count()).toBe(0);
    expect(await db.workBlock.count()).toBe(0);
    expect(await db.executionSession.count()).toBe(0);
    expect(await db.schedulerEvent.count()).toBe(0);
  });
});

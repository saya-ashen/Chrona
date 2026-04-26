import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";

const enqueueTaskPlanGenerationMock = mock(async () => undefined);

mock.module("@/modules/commands/queue-task-plan-generation", () => ({
  enqueueTaskPlanGeneration: enqueueTaskPlanGenerationMock,
}));

import { createTask } from "@/modules/commands/create-task";

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

describe("createTask automatic plan generation", () => {
  beforeEach(async () => {
    await resetDb();
    enqueueTaskPlanGenerationMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("asks the backend plan-generation queue to plan the newly persisted task", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Plan Workspace", status: "Active", defaultRuntime: "openclaw" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task and plan it",
      description: "This task is never opened in the UI before planning.",
      runtimeAdapterKey: "openclaw",
      runtimeInput: { prompt: "Do it" },
      prompt: "Do it",
    });

    expect(enqueueTaskPlanGenerationMock).toHaveBeenCalledWith({
      taskId: result.taskId,
      reason: "task_created",
    });
  });
});

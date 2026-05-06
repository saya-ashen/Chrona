import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";

// Auto plan generation was removed in the plan refactor.
// Plan generation is now manual-only via the SSE streaming endpoint.
// This test verifies createTask does NOT trigger any plan generation.

const materializationMock = mock(async () => undefined);

mock.module("@/modules/commands/materialize-generated-task-plan", () => ({
  materializeGeneratedTaskPlan: materializationMock,
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

describe("createTask (no auto plan generation)", () => {
  beforeEach(async () => {
    await resetDb();
    materializationMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("creates a task but does NOT trigger any plan generation", async () => {
    const workspace = await db.workspace.create({
      data: { name: "No Auto Plan Workspace", status: "Active", defaultRuntime: "openclaw" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task without auto plan",
      description: "Plan generation must be explicitly requested via the SSE endpoint.",
      runtimeAdapterKey: "openclaw",
      runtimeInput: { prompt: "Do it" },
      prompt: "Do it",
    });

    expect(result.taskId).toBeDefined();

    // Plan generation is now manual-only — no automatic enqueue.
    expect(materializationMock).not.toHaveBeenCalled();
  });
});

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";

// Auto plan generation was removed in the plan refactor.
// Plan generation is now manual-only via the SSE streaming endpoint.
// This test verifies createTask does NOT trigger any plan generation.

const materializationMock = mock(async () => undefined);

mock.module("@/modules/plans/materialize-generated-task-plan", () => ({
  materializeGeneratedTaskPlan: materializationMock,
}));

import { createTask } from "@/modules/tasks/create-task";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
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
      data: { name: "No Auto Plan Workspace", status: "Active", defaultRuntime: "hermes" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task without auto plan",
      description: "Plan generation must be explicitly requested via the SSE endpoint.",
      executionRuntime: "hermes",
      executionConfig: { prompt: "Do it" },
    });

    expect(result.taskId).toBeDefined();

    // Plan generation is now manual-only — no automatic enqueue.
    expect(materializationMock).not.toHaveBeenCalled();
  });

  it("persists and returns the explicit task auto-execute choice", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Execute Workspace", status: "Active", defaultRuntime: "hermes" },
    });

    const enabled = await createTask({
      workspaceId: workspace.id,
      title: "Explicit auto execute enabled",
      autoExecute: true,
      executionRuntime: "hermes",
      executionConfig: { prompt: "Do it" },
    });
    const disabled = await createTask({
      workspaceId: workspace.id,
      title: "Explicit auto execute disabled",
      autoExecute: false,
      executionRuntime: "hermes",
      executionConfig: { prompt: "Do it" },
    });

    const persisted = await db.task.findMany({
      where: { id: { in: [enabled.taskId, disabled.taskId] } },
      select: { id: true, autoExecute: true },
    });
    const persistedById = new Map(persisted.map((task) => [task.id, task.autoExecute]));

    expect(enabled.autoExecute).toBe(true);
    expect(disabled.autoExecute).toBe(false);
    expect(persistedById.get(enabled.taskId)).toBe(true);
    expect(persistedById.get(disabled.taskId)).toBe(false);
    expect(materializationMock).not.toHaveBeenCalled();
  });
});

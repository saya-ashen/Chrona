import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";

const autoPlanGenerationMock = mock(() => undefined);

mock.module("@/modules/plans/auto-generate-task-plan", () => ({
  startAutoPlanGenerationForTask: autoPlanGenerationMock,
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

describe("createTask auto plan generation", () => {
  beforeEach(async () => {
    await resetDb();
    autoPlanGenerationMock.mockClear();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("does not trigger plan generation when automation is disabled", async () => {
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
    expect(autoPlanGenerationMock).not.toHaveBeenCalled();
  });

  it("starts and accepts automatic plan generation when auto-execute is enabled", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Plan Workspace", status: "Active", defaultRuntime: "hermes" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task with auto plan",
      description: "Plan generation should start in the background.",
      autoExecute: true,
      autoPlanGenerationTiming: "immediate",
      executionRuntime: "hermes",
      executionConfig: { prompt: "Do it" },
    });

    expect(autoPlanGenerationMock).toHaveBeenCalledWith({ taskId: result.taskId, accept: true });
  });

  it("starts draft plan generation when only auto-plan is enabled", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Draft Plan Workspace", status: "Active", defaultRuntime: "hermes" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task with auto draft plan",
      description: "Plan generation should start without accepting the plan.",
      autoPlanGeneration: true,
      autoExecute: false,
      autoPlanGenerationTiming: "immediate",
      executionRuntime: "hermes",
      executionConfig: { prompt: "Do it" },
    });

    const persisted = await db.task.findUniqueOrThrow({ where: { id: result.taskId } });

    expect(result.autoPlanGeneration).toBe(true);
    expect(result.autoExecute).toBe(false);
    expect(persisted.autoPlanGeneration).toBe(true);
    expect(persisted.autoExecute).toBe(false);
    expect(autoPlanGenerationMock).toHaveBeenCalledWith({ taskId: result.taskId, accept: false });
  });

  it("persists and returns the explicit task auto-execute choice", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Execute Workspace", status: "Active", defaultRuntime: "hermes" },
    });

    const enabled = await createTask({
      workspaceId: workspace.id,
      title: "Explicit auto execute enabled",
      autoExecute: true,
      autoPlanGenerationTiming: "immediate",
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
      select: { id: true, autoPlanGeneration: true, autoExecute: true },
    });
    const persistedById = new Map(persisted.map((task) => [task.id, task]));

    expect(enabled.autoPlanGeneration).toBe(true);
    expect(enabled.autoExecute).toBe(true);
    expect(disabled.autoPlanGeneration).toBe(false);
    expect(disabled.autoExecute).toBe(false);
    expect(persistedById.get(enabled.taskId)?.autoPlanGeneration).toBe(true);
    expect(persistedById.get(enabled.taskId)?.autoExecute).toBe(true);
    expect(persistedById.get(disabled.taskId)?.autoPlanGeneration).toBe(false);
    expect(persistedById.get(disabled.taskId)?.autoExecute).toBe(false);
    expect(autoPlanGenerationMock).toHaveBeenCalledTimes(1);
    expect(autoPlanGenerationMock).toHaveBeenCalledWith({ taskId: enabled.taskId, accept: true });
  });
});

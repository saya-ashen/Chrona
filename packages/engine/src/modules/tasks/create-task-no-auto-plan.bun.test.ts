import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";

const autoPlanGenerationMock = mock(() => undefined);

mock.module("@/modules/plans/auto-generate-task-plan", () => ({
  startAutoPlanGenerationForTask: autoPlanGenerationMock,
}));

import { createTask } from "@/modules/tasks/create-task";
import { updateTask } from "@/modules/tasks/update-task";

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
      data: { name: "No Auto Plan Workspace", status: "Active" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task without auto plan",
      description: "Plan generation must be explicitly requested via the SSE endpoint.",
      executionConfig: { prompt: "Do it" },
    });

    expect(result.taskId).toBeDefined();
    expect(autoPlanGenerationMock).not.toHaveBeenCalled();
  });

  it("does not start planning or execution during creation when auto-execute is enabled", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Plan Workspace", status: "Active" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task with deferred automation",
      description: "Creation must not start plan generation or execution.",
      autoExecute: true,
      autoPlanGenerationTiming: "immediate",
      executionConfig: { prompt: "Do it" },
    });

    expect(result.autoPlanGeneration).toBe(true);
    expect(result.autoExecute).toBe(true);
    expect(autoPlanGenerationMock).not.toHaveBeenCalled();
  });

  it("persists auto-plan preference without starting generation during creation", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Auto Draft Plan Workspace", status: "Active" },
    });

    const result = await createTask({
      workspaceId: workspace.id,
      title: "Create task with deferred draft plan",
      description: "Plan generation must be requested by a later command.",
      autoPlanGeneration: true,
      autoExecute: false,
      autoPlanGenerationTiming: "immediate",
      executionConfig: { prompt: "Do it" },
    });

    const persisted = await db.task.findUniqueOrThrow({ where: { id: result.taskId } });

    expect(result.autoPlanGeneration).toBe(true);
    expect(result.autoExecute).toBe(false);
    expect(persisted.autoPlanGeneration).toBe(true);
    expect(persisted.autoExecute).toBe(false);
    expect(autoPlanGenerationMock).not.toHaveBeenCalled();
  });

  it("persists explicit automation choices without triggering creation side effects", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Automation Preferences Workspace", status: "Active" },
    });

    const enabled = await createTask({
      workspaceId: workspace.id,
      title: "Explicit auto execute enabled",
      autoExecute: true,
      autoPlanGenerationTiming: "immediate",
      executionConfig: { prompt: "Do it" },
    });
    const disabled = await createTask({
      workspaceId: workspace.id,
      title: "Explicit auto execute disabled",
      autoExecute: false,
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
    expect(autoPlanGenerationMock).not.toHaveBeenCalled();
  });




  it("keeps one task entry when workspace edit enables recurrence", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Workspace recurrence edit", status: "Active" },
    });
    const result = await createTask({
      workspaceId: workspace.id,
      title: "Review metrics",
      executionConfig: { prompt: "Review" },
    });

    await updateTask({
      taskId: result.taskId,
      recurrenceRule: "FREQ=DAILY;COUNT=3",
      recurrenceAnchorStartAt: "2026-06-01T09:00:00.000Z",
      recurrenceAnchorEndAt: "2026-06-01T10:00:00.000Z",
    });

    const tasks = await db.task.findMany({
      where: { workspaceId: workspace.id },
      include: { workBlocks: { orderBy: { scheduledStartAt: "asc" } } },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.kind).toBe("recurring");
    expect(tasks[0]?.seriesExternalUid).toBeNull();
    expect(tasks[0]?.recurrenceRule).toBe("FREQ=DAILY;COUNT=3");
    expect(tasks[0]?.workBlocks.map((block) => block.recurrenceKey)).toEqual([
      "schedule:v1:2026-06-01T09:00:00.000Z",
      "schedule:v1:2026-06-02T09:00:00.000Z",
      "schedule:v1:2026-06-03T09:00:00.000Z",
    ]);

    const firstTrigger = await db.taskTrigger.findUniqueOrThrow({
      where: { taskId_kind: { taskId: result.taskId, kind: "schedule" } },
    });
    const firstOccurrences = await db.taskOccurrence.findMany({
      where: { taskId: result.taskId, triggerVersion: 1 },
      include: { workBlock: true },
    });
    expect(firstTrigger).toMatchObject({ version: 1, state: "Enabled" });
    expect(firstOccurrences).toHaveLength(3);
    expect(firstOccurrences.every((occurrence) => occurrence.workBlock?.recurrenceKey === occurrence.occurrenceKey)).toBe(true);

    await updateTask({
      taskId: result.taskId,
      recurrenceRule: "FREQ=WEEKLY;COUNT=2",
      recurrenceAnchorStartAt: "2026-06-01T09:00:00.000Z",
      recurrenceAnchorEndAt: "2026-06-01T10:00:00.000Z",
    });

    const updatedTrigger = await db.taskTrigger.findUniqueOrThrow({
      where: { taskId_kind: { taskId: result.taskId, kind: "schedule" } },
    });
    const updatedOccurrences = await db.taskOccurrence.findMany({
      where: { taskId: result.taskId },
      include: { workBlock: true },
      orderBy: { occurrenceKey: "asc" },
    });
    expect(updatedTrigger).toMatchObject({
      version: 2,
      state: "Enabled",
      config: expect.objectContaining({ rrule: "FREQ=WEEKLY;COUNT=2" }),
    });
    expect(updatedOccurrences.filter((occurrence) => occurrence.triggerVersion === 1).every((occurrence) => occurrence.status === "Cancelled")).toBe(true);
    const currentOccurrences = updatedOccurrences.filter((occurrence) => occurrence.triggerVersion === 2);
    expect(currentOccurrences.map((occurrence) => occurrence.occurrenceKey)).toEqual([
      "schedule:v2:2026-06-01T09:00:00.000Z",
      "schedule:v2:2026-06-08T09:00:00.000Z",
    ]);
    expect(currentOccurrences.every((occurrence) => occurrence.workBlock?.recurrenceKey === occurrence.occurrenceKey)).toBe(true);
  });

  it("cancels open work blocks when a recurring task is cancelled", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Cancel recurring workspace", status: "Active" },
    });
    const result = await createTask({
      workspaceId: workspace.id,
      title: "Review trends",
      recurrenceRule: "FREQ=DAILY;COUNT=3",
      recurrenceAnchorStartAt: "2026-06-01T09:00:00.000Z",
      recurrenceAnchorEndAt: "2026-06-01T10:00:00.000Z",
      executionConfig: { prompt: "Review" },
    });

    await updateTask({ taskId: result.taskId, status: "Cancelled" });

    const rootBlocks = await db.workBlock.findMany({
      where: { taskId: result.taskId },
      select: { status: true, completedAt: true },
    });
    const taskCount = await db.task.count({ where: { workspaceId: workspace.id } });

    expect(taskCount).toBe(1);
    expect(rootBlocks).toHaveLength(3);
    expect(rootBlocks.every((block) => block.status === "Cancelled")).toBe(true);
    expect(rootBlocks.every((block) => block.completedAt instanceof Date)).toBe(true);
    expect(await db.taskTrigger.findUniqueOrThrow({ where: { taskId_kind: { taskId: result.taskId, kind: "schedule" } } })).toMatchObject({ state: "Retired", version: 2 });
    expect(await db.taskOccurrence.count({ where: { taskId: result.taskId, status: { not: "Cancelled" } } })).toBe(0);
  });
});

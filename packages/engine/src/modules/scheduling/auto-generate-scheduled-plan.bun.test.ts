import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";

const startAutoPlanMock = mock();
mock.module("@/modules/plans/auto-generate-task-plan", () => ({
  startAutoPlanGenerationForTask: startAutoPlanMock,
}));

const { autoGenerateScheduledPlanTasks } = await import(
  "@/modules/scheduling/auto-generate-scheduled-plan"
);

async function resetDb() {
  await db.workBlock.deleteMany();
  await db.taskProjection.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createWorkspace() {
  return db.workspace.create({
    data: { name: "Auto Plan Workspace", status: "Active", defaultRuntime: "hermes" },
  });
}

async function createTaskRow(workspaceId: string, overrides: Record<string, unknown> = {}) {
  return db.task.create({
    data: {
      workspaceId,
      title: "Auto plan task",
      status: "Ready",
      priority: "High",
      autoPlanGeneration: true,
      autoExecute: false,
      executionRuntime: "hermes",
      executionConfig: { prompt: "Run task", sessionStrategy: "per_subtask" },
      ...overrides,
    },
  });
}

async function createScheduledBlock(
  workspaceId: string,
  taskId: string,
  overrides: { scheduledStartAt?: Date; scheduledEndAt?: Date; status?: "Scheduled" | "Active" } = {},
) {
  return db.workBlock.create({
    data: {
      workspaceId,
      taskId,
      title: "Block",
      status: overrides.status ?? "Scheduled",
      scheduledStartAt: overrides.scheduledStartAt ?? new Date(Date.now() - 5 * 60_000),
      scheduledEndAt: overrides.scheduledEndAt ?? new Date(Date.now() + 55 * 60_000),
      trigger: "scheduled",
    },
  });
}

describe("auto-generate-scheduled-plan", () => {
  beforeEach(async () => {
    startAutoPlanMock.mockReset();
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    mock.restore();
  });

  it("fires when scheduled start (at_start timing) is due", async () => {
    const workspace = await createWorkspace();
    const task = await createTaskRow(workspace.id, {
      autoPlanGenerationTiming: "at_start",
      autoExecute: true,
    });
    const block = await createScheduledBlock(workspace.id, task.id, {
      scheduledStartAt: new Date(Date.now() - 60_000),
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([{ taskId: task.id, workBlockId: block.id, reason: "scheduled" }]);
    expect(startAutoPlanMock).toHaveBeenCalledWith({ taskId: task.id, workBlockId: block.id, accept: true });
  });

  it("skips immediate timing (handled inline at create/update)", async () => {
    const workspace = await createWorkspace();
    const task = await createTaskRow(workspace.id, { autoPlanGenerationTiming: "immediate" });
    const block = await createScheduledBlock(workspace.id, task.id, {
      scheduledStartAt: new Date(Date.now() - 60_000),
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([]);
    expect(result.skipped).toContainEqual({ taskId: task.id, workBlockId: block.id, reason: "immediate_handled_inline" });
    expect(startAutoPlanMock).not.toHaveBeenCalled();
  });

  it("does not fire before the offset trigger time (before_1h, not yet due)", async () => {
    const workspace = await createWorkspace();
    const task = await createTaskRow(workspace.id, { autoPlanGenerationTiming: "before_1h" });
    // start in 90m → trigger (start - 60m) is 30m in the future → not due yet
    await createScheduledBlock(workspace.id, task.id, {
      scheduledStartAt: new Date(Date.now() + 90 * 60_000),
      scheduledEndAt: new Date(Date.now() + 150 * 60_000),
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([]);
    expect(startAutoPlanMock).not.toHaveBeenCalled();
  });

  it("fires once the before_1h offset window opens", async () => {
    const workspace = await createWorkspace();
    const task = await createTaskRow(workspace.id, { autoPlanGenerationTiming: "before_1h" });
    // start in 30m → trigger (start - 60m) was 30m ago → due
    const block = await createScheduledBlock(workspace.id, task.id, {
      scheduledStartAt: new Date(Date.now() + 30 * 60_000),
      scheduledEndAt: new Date(Date.now() + 90 * 60_000),
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([{ taskId: task.id, workBlockId: block.id, reason: "scheduled" }]);
    expect(startAutoPlanMock).toHaveBeenCalledTimes(1);
  });

  it("skips when an active plan already exists", async () => {
    const workspace = await createWorkspace();
    const task = await createTaskRow(workspace.id, { autoPlanGenerationTiming: "at_start" });
    const block = await createScheduledBlock(workspace.id, task.id, {
      scheduledStartAt: new Date(Date.now() - 60_000),
    });
    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: block.id,
      status: "accepted",
      summary: "accepted graph",
      generatedBy: "auto-generate-test",
      compiledPlan: {
        id: `graph-${task.id}`,
        editablePlanId: `ep-${task.id}`,
        sourceVersion: 1,
        title: task.title,
        goal: task.title,
        assumptions: [],
        nodes: [],
        edges: [],
        entryNodeIds: [],
        terminalNodeIds: [],
        topologicalOrder: [],
        completionPolicy: { type: "all_tasks_completed" },
        validationWarnings: [],
      },
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([]);
    expect(result.skipped).toContainEqual({ taskId: task.id, workBlockId: block.id, reason: "plan_exists" });
    expect(startAutoPlanMock).not.toHaveBeenCalled();
  });

  it("fires no_schedule_fallback for an unscheduled task past the grace window", async () => {
    const workspace = await createWorkspace();
    const task = await createTaskRow(workspace.id, {
      autoPlanGenerationTiming: "at_start",
      createdAt: new Date(Date.now() - 120_000),
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([{ taskId: task.id, workBlockId: null, reason: "no_schedule_fallback" }]);
    expect(startAutoPlanMock).toHaveBeenCalledWith({ taskId: task.id, workBlockId: null, accept: false });
  });

  it("waits during the grace window before the no-schedule fallback", async () => {
    const workspace = await createWorkspace();
    await createTaskRow(workspace.id, {
      autoPlanGenerationTiming: "at_start",
      createdAt: new Date(Date.now() - 5_000),
    });

    const result = await autoGenerateScheduledPlanTasks({ now: new Date() });

    expect(result.triggered).toEqual([]);
    expect(startAutoPlanMock).not.toHaveBeenCalled();
  });
});

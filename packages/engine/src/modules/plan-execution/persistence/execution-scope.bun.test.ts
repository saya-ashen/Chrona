import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { upgradeBlueprintToEditable, type PlanBlueprint } from "@chrona/contracts";
import { compilePlanBlueprint } from "@chrona/domain";
import {
  getAcceptedCompiledPlan,
  saveCompiledPlan,
} from "@/modules/plan-execution/persistence/compiled-plan-store";
import {
  resolveExecutionScope,
  getAcceptedCompiledPlanForTask,
} from "./execution-scope";

function blueprint(title: string): PlanBlueprint {
  return {
    title,
    goal: title,
    nodes: [
      { id: "handle_task", type: "task" as const, title: `Handle ${title}`, expectedOutput: title },
    ],
    edges: [],
  };
}

async function resetDb() {
  await db.executionSession.deleteMany();
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.taskOccurrence.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskSession.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createTaskWithWorkBlock() {
  const workspace = await db.workspace.create({
    data: { name: "Execution scope", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Recurring occurrence",
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });
  const workBlock = await db.workBlock.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      title: task.title,
      status: "Scheduled",
      scheduledStartAt: new Date("2026-06-01T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-06-01T10:00:00.000Z"),
      trigger: "scheduled",
    },
  });
  return { workspace, task, workBlock };
}

/** Compile and accept a plan scoped to the work block. */
async function acceptPlanAtWorkBlock(input: {
  taskId: string;
  workspaceId: string;
  workBlockId: string;
}) {
  const candidate = blueprint("Occurrence plan");
  const { compiledPlan, planId } = compilePlanBlueprint({
    taskId: input.taskId,
    blueprint: candidate,
    planId: `plan_${input.workBlockId}`,
    generatedBy: "test",
    source: "ai",
  });
  await saveCompiledPlan({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workBlockId: input.workBlockId,
    compiledPlan,
    editablePlan: upgradeBlueprintToEditable(candidate, planId, 1),
    status: "accepted",
  });
  return planId;
}

describe("resolveExecutionScope", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("recovers the work block of a work-block-scoped accepted plan when caller has only a taskId", async () => {
    const { workspace, task, workBlock } = await createTaskWithWorkBlock();
    await acceptPlanAtWorkBlock({ taskId: task.id, workspaceId: workspace.id, workBlockId: workBlock.id });

    const scope = await resolveExecutionScope(task.id);
    expect(scope.workBlockId).toBe(workBlock.id);
  });

  it("regression: getAcceptedCompiledPlanForTask finds a work-block-scoped accepted plan from a bare taskId", async () => {
    const { workspace, task, workBlock } = await createTaskWithWorkBlock();
    await acceptPlanAtWorkBlock({ taskId: task.id, workspaceId: workspace.id, workBlockId: workBlock.id });

    // The historical failure: null-scoped lookup could not see the plan.
    expect(await getAcceptedCompiledPlan(task.id, null)).toBeNull();
    // The fix: scope-aware lookup recovers it (this is what node.output / reads now use).
    const accepted = await getAcceptedCompiledPlanForTask(task.id);
    expect(accepted).not.toBeNull();
    expect(accepted?.workBlockId).toBe(workBlock.id);
  });

  it("prefers the live Active/Paused ExecutionSession's work block over the latest accepted plan", async () => {
    const { workspace, task, workBlock } = await createTaskWithWorkBlock();
    const planId = await acceptPlanAtWorkBlock({ taskId: task.id, workspaceId: workspace.id, workBlockId: workBlock.id });

    const otherBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: "Next occurrence",
        status: "Active",
        scheduledStartAt: new Date("2026-06-02T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-02T10:00:00.000Z"),
        trigger: "scheduled",
      },
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: otherBlock.id,
        planId,
        activeScopeKey: "active",
        status: "Active",
        completedNodeIds: "[]",
      },
    });

    const scope = await resolveExecutionScope(task.id);
    expect(scope.workBlockId).toBe(otherBlock.id);
    expect(scope.executionSessionId).not.toBeNull();
  });

  it("lets an explicitly owned concrete workBlockId hint win", async () => {
    const { workspace, task, workBlock } = await createTaskWithWorkBlock();
    const planId = await acceptPlanAtWorkBlock({ taskId: task.id, workspaceId: workspace.id, workBlockId: workBlock.id });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: workBlock.id,
        planId,
        activeScopeKey: "active",
        status: "Active",
        completedNodeIds: "[]",
      },
    });

    const scope = await resolveExecutionScope(task.id, { workBlockId: workBlock.id });
    expect(scope.workBlockId).toBe(workBlock.id);
  });

  it("fails closed when an explicit work block belongs to another task", async () => {
    const { task } = await createTaskWithWorkBlock();
    const { workBlock: foreignWorkBlock } = await createTaskWithWorkBlock();

    const scope = await resolveExecutionScope(task.id, { workBlockId: foreignWorkBlock.id });

    expect(scope).toEqual({
      occurrenceId: null,
      workBlockId: null,
      planId: null,
      executionSessionId: null,
    });
  });

  it("resolves an explicit occurrence without inventing a WorkBlock", async () => {
    const { workspace, task } = await createTaskWithWorkBlock();
    const occurrence = await db.taskOccurrence.create({ data: { workspaceId: workspace.id, taskId: task.id, occurrenceKey: "event:test", source: { kind: "system", reason: "test" }, status: "Ready", eligibleAt: new Date() } });
    const scope = await resolveExecutionScope(task.id, { occurrenceId: occurrence.id });
    expect(scope).toMatchObject({ occurrenceId: occurrence.id, workBlockId: null });
    expect(await db.workBlock.count({ where: { occurrence: { id: occurrence.id } } })).toBe(0);
  });

  it("resolves to null for a task with no plan and no execution", async () => {
    const { task } = await createTaskWithWorkBlock();
    const scope = await resolveExecutionScope(task.id);
    expect(scope.workBlockId).toBeNull();
  });
});

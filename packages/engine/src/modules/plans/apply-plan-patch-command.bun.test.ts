import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { Prisma, TaskPlanGenerationHeadStatus, TaskPlanStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { compilePlanBlueprint } from "@chrona/domain";

import { applyPlanPatchCommand } from "./apply-plan-patch-command";
import { TaskPlanning } from "./task-planning";

async function resetDb() {
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlanGenerationHead.deleteMany();
  await db.taskPlan.deleteMany();
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.taskDependency.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskSession.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedCurrentPlan() {
  const workspace = await db.workspace.create({
    data: { name: "Plan command CAS", status: "Active" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Plan command task",
      status: "Ready",
      priority: "Medium",
      executionConfig: {},
    },
  });
  const { compiledPlan, planId } = compilePlanBlueprint({
    taskId: task.id,
    planId: "plan-command-test",
    blueprint: {
      title: "Plan command test",
      goal: "Exercise command persistence",
      nodes: [{ id: "start", type: "task", title: "Start", expectedOutput: "Started" }],
      edges: [],
    },
  });
  await db.taskPlan.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId,
      revision: compiledPlan.sourceVersion,
      status: TaskPlanStatus.Draft,
      compiledPlan: compiledPlan as unknown as Prisma.InputJsonValue,
    },
  });
  await db.taskPlanGenerationHead.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockScopeKey: "",
      currentPlanId: planId,
      currentPlanRevision: compiledPlan.sourceVersion,
      currentPlanStatus: TaskPlanStatus.Draft,
      stateVersion: 5,
      status: TaskPlanGenerationHeadStatus.Current,
    },
  });
  return { workspace, task, compiledPlan, planId };
}

describe("plan command CAS and idempotency", () => {
  beforeEach(resetDb);

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("does not leave a PlanRun, receipt, or graph mutation when the head CAS is stale", async () => {
    const { task, planId } = await seedCurrentPlan();

    await expect(applyPlanPatchCommand({
      taskId: task.id,
      expectedHeadStateVersion: 4,
      idempotencyKey: "stale-patch",
      operation: "add_node",
      nodes: [{ id: "follow-up", title: "Follow up" }],
    })).rejects.toBeDefined();

    expect(await db.taskPlanRun.count({ where: { taskId: task.id, planId } })).toBe(0);
    expect(await db.event.count({ where: { dedupeKey: "task_plan.patch:stale-patch" } })).toBe(0);
    expect(await db.taskPlanGenerationHead.findUnique({
      where: { taskId_workBlockScopeKey: { taskId: task.id, workBlockScopeKey: "" } },
      select: { stateVersion: true },
    })).toMatchObject({ stateVersion: 5 });
  });

  it("returns the persisted receipt for a same-key retry with an old expected head version", async () => {
    const { task, planId } = await seedCurrentPlan();
    const input = {
      taskId: task.id,
      expectedHeadStateVersion: 5,
      idempotencyKey: "patch-once",
      operation: "add_node",
      nodes: [{ id: "follow-up", title: "Follow up" }],
    };

    const first = await applyPlanPatchCommand(input);
    const retry = await applyPlanPatchCommand({ ...input, expectedHeadStateVersion: 4 });
    const run = await db.taskPlanRun.findUnique({
      where: { taskId_planId_workBlockScopeKey: { taskId: task.id, planId, workBlockScopeKey: "" } },
      select: { planRun: true },
    });

    expect(retry).toEqual(first);
    expect(run?.planRun).toMatchObject({
      mutableGraph: { graph: { mutations: [{ id: "patch-once" }] } },
    });
    expect(await db.event.count({ where: { dedupeKey: "task_plan.patch:patch-once" } })).toBe(1);
    expect(await db.taskPlanGenerationHead.findUnique({
      where: { taskId_workBlockScopeKey: { taskId: task.id, workBlockScopeKey: "" } },
      select: { stateVersion: true },
    })).toMatchObject({ stateVersion: 6 });
  });

  it("rejects idempotency-key reuse with a different patch operation or payload", async () => {
    const { task } = await seedCurrentPlan();
    const input = {
      taskId: task.id,
      expectedHeadStateVersion: 5,
      idempotencyKey: "patch-conflict",
      operation: "add_node",
      nodes: [{ id: "follow-up", title: "Follow up" }],
    };

    await applyPlanPatchCommand(input);

    await expect(applyPlanPatchCommand({
      ...input,
      expectedHeadStateVersion: 6,
      operation: "delete_node",
      deletedNodeIds: ["follow-up"],
      nodes: undefined,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(applyPlanPatchCommand({
      ...input,
      expectedHeadStateVersion: 6,
      nodes: [{ id: "follow-up", title: "Different follow up" }],
    })).rejects.toMatchObject({ code: "CONFLICT" });
    const run = await db.taskPlanRun.findFirst({
      where: { taskId: task.id },
      select: { planRun: true },
    });
    expect(run?.planRun).toMatchObject({
      mutableGraph: { graph: { mutations: [{ id: "patch-conflict" }] } },
    });
  });

  it("rejects idempotency-key reuse across scopes and tasks", async () => {
    const { workspace, task } = await seedCurrentPlan();
    const input = {
      taskId: task.id,
      expectedHeadStateVersion: 5,
      idempotencyKey: "patch-scope-conflict",
      operation: "add_node",
      nodes: [{ id: "follow-up", title: "Follow up" }],
    };
    await applyPlanPatchCommand(input);

    await expect(applyPlanPatchCommand({ ...input, workBlockId: "different-scope" })).rejects.toMatchObject({ code: "CONFLICT" });

    const otherTask = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Other plan command task",
        status: "Ready",
        priority: "Medium",
        executionConfig: {},
      },
    });
    await expect(applyPlanPatchCommand({ ...input, taskId: otherTask.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("deduplicates plan acceptance by Event receipt and rejects key reuse for another plan", async () => {
    const { task, planId } = await seedCurrentPlan();
    const planning = new TaskPlanning();
    const command = {
      taskId: task.id,
      planId,
      expectedHeadStateVersion: 5,
      idempotencyKey: "accept-once",
    };

    const first = await planning.accept(command);
    const retry = await planning.accept(command);

    expect(retry).toEqual(first);
    expect(await db.event.count({ where: { dedupeKey: "task_plan.accept:accept-once" } })).toBe(1);
    await expect(planning.accept({ ...command, planId: "different-plan" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

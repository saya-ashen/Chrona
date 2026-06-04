import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import type { PlanBlueprint } from "@chrona/contracts";
import { isEngineError } from "../../errors";

import { materializeGeneratedTaskPlan } from "./materialize-generated-task-plan";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { getPlanRun, savePlanRun } from "@/modules/plan-execution/plan-run-store";
import { getLatestTaskPlanReadModel } from "@/modules/plans/task-plan-read-model";

function blueprint(title: string): PlanBlueprint {
  return {
    title,
    goal: title,
    nodes: [
      {
        id: "handle_task",
        type: "task" as const,
        title: `Handle ${title}`,
        expectedOutput: title,
      },
    ],
    edges: [],
  };
}

async function resetDb() {
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.event.deleteMany();
  await db.taskProjection.deleteMany();
  await db.taskSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createTask() {
  const workspace = await db.workspace.create({
    data: { name: "Materialize Guard", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Guarded task",
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });
  return { workspace, task };
}

/** Accept the latest plan and force its run into the given status. */
async function acceptAndSetRunStatus(
  taskId: string,
  workspaceId: string,
  status: "running" | "paused" | "completed" | "cancelled",
) {
  const latest = await getLatestTaskPlanReadModel(taskId);
  if (!latest) throw new Error("expected a materialized plan");

  const row = await db.taskPlan.findFirstOrThrow({ where: { taskId, planId: latest.id } });
  await saveCompiledPlan({
    workspaceId,
    taskId,
    compiledPlan: row.compiledPlan as never,
    editablePlan: row.editablePlan as never,
    status: "accepted",
  });

  const run = await getPlanRun(taskId, latest.id, null);
  if (!run) throw new Error("expected a plan run");
  await savePlanRun({
    workspaceId,
    taskId,
    planId: latest.id,
    run: { ...run.planRun, status },
  });

  return latest.id;
}

describe("materializeGeneratedTaskPlan active-execution guard", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("rejects regeneration while the accepted plan is running", async () => {
    const { workspace, task } = await createTask();

    await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      blueprint: blueprint("First plan"),
    });
    const acceptedPlanId = await acceptAndSetRunStatus(task.id, workspace.id, "running");

    let thrown: unknown;
    try {
      await materializeGeneratedTaskPlan({
        taskId: task.id,
        workspaceId: workspace.id,
        blueprint: blueprint("Second plan"),
      });
    } catch (cause) {
      thrown = cause;
    }

    expect(isEngineError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe("CONFLICT");

    // The running plan must remain the latest/accepted one — not shadowed by a draft.
    const latest = await getLatestTaskPlanReadModel(task.id);
    expect(latest?.id).toBe(acceptedPlanId);
    expect(latest?.status).toBe("accepted");
  });

  it("rejects regeneration while the accepted plan is paused", async () => {
    const { workspace, task } = await createTask();

    await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      blueprint: blueprint("First plan"),
    });
    await acceptAndSetRunStatus(task.id, workspace.id, "paused");

    expect(
      materializeGeneratedTaskPlan({
        taskId: task.id,
        workspaceId: workspace.id,
        blueprint: blueprint("Second plan"),
      }),
    ).rejects.toThrow();
  });

  it("allows regeneration when no plan has been accepted yet (draft only)", async () => {
    const { workspace, task } = await createTask();

    await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      blueprint: blueprint("First draft"),
    });

    const second = await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      blueprint: blueprint("Second draft"),
    });

    expect(second.summary).toBe("Second draft");
    const latest = await getLatestTaskPlanReadModel(task.id);
    expect(latest?.id).toBe(second.id);
  });

  it("allows regeneration after the accepted plan run has terminated", async () => {
    const { workspace, task } = await createTask();

    await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      blueprint: blueprint("First plan"),
    });
    await acceptAndSetRunStatus(task.id, workspace.id, "completed");

    const regenerated = await materializeGeneratedTaskPlan({
      taskId: task.id,
      workspaceId: workspace.id,
      blueprint: blueprint("Recovery plan"),
    });

    expect(regenerated.summary).toBe("Recovery plan");
  });
});

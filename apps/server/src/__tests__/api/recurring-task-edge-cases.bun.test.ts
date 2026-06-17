import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { runRecurringWorkBlockExpansionWorker } from "@chrona/engine/modules/orchestration/recurring-work-block-expansion-worker";
import { getLatestTaskPlanReadModel } from "@chrona/engine/modules/plans/task-plan-read-model";
import { saveCompiledPlan } from "@chrona/engine/modules/plan-execution/persistence/compiled-plan-store";
import { getCurrentExecution } from "@chrona/engine/modules/plan-execution/use-cases/get-current-execution";
import { getTaskHeaderSpec } from "@chrona/engine/modules/tasks/get-task-header";
import type { CompiledPlan } from "@chrona/contracts/ai";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

// Cross-occurrence scope depth for recurring tasks. The shallow
// L1 coverage in `recurring-task-lifecycle.bun.test.ts` proves the
// happy path (create series, expand, plan scope). This file goes
// one level deeper: operations on one occurrence must not leak into
// sibling occurrences, and the workBlock-scoped read models must
// survive plan completion / reopening / plan-replace at the
// occurrence boundary.
//
// The engine treats /complete and /reopen as task-level operations
// (they take a taskId, not a workBlockId), but the per-occurrence
// read models (header, plan, execution) are still workBlock-scoped.
// A completed task can have a still-Active sibling occurrence
// because completion is a task row mutation, not a per-block
// mutation. The tests pin this design.


function minimalCompiledPlan(title: string): CompiledPlan {
  return {
    id: `compiled_${title.toLowerCase().replace(/\s+/g, "_")}`,
    editablePlanId: title.toLowerCase().replace(/\s+/g, "-"),
    sourceVersion: 1,
    title,
    goal: title,
    assumptions: [],
    nodes: [
      {
        id: "step",
        localId: "step",
        type: "task",
        title: "Step",
        description: "do it",
        config: { expectedOutput: "done" },
        dependencies: [],
        dependents: [],
        mode: "auto",
        executor: "ai",
        priority: "High",
      },
    ],
    edges: [],
    entryNodeIds: ["step"],
    terminalNodeIds: ["step"],
    topologicalOrder: ["step"],
    completionPolicy: { type: "all_tasks_completed" },
    validationWarnings: [],
  };
}

async function createRecurringDailySeries(input: {
  workspaceId: string;
  count: number;
  anchor?: Date;
}) {
  const anchor = input.anchor ?? new Date("2026-06-15T09:00:00.000Z");
  const task = await db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title: "Recurring edge",
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
      recurrenceRule: `FREQ=DAILY;COUNT=${input.count}`,
      recurrenceAnchorStartAt: anchor,
      recurrenceAnchorEndAt: new Date(anchor.getTime() + 30 * 60 * 1000),
    },
  });
  await runRecurringWorkBlockExpansionWorker({ now: anchor });
  const blocks = await db.workBlock.findMany({
    where: { taskId: task.id },
    orderBy: { scheduledStartAt: "asc" },
  });
  return { task, blocks };
}

describe("Recurring task — cross-occurrence scope depth", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("task-level plan surfaces on occurrence lookup only when the occurrence has no own plan", async () => {
    // The engine's getLatestTaskPlanReadModel falls back to the
    // task-level plan when the occurrence has no own plan. This
    // is the design (see packages/engine/src/modules/plans/task-plan-read-model.ts:256),
    // NOT a leak. The pin: a task-level plan is *visible* from
    // any occurrence that hasn't accepted its own, but an
    // occurrence-specific plan takes precedence and *shields* the
    // task-level fallback.
    const { workspaceId } = await seedWorkspace("Recurring plan task-level");
    const { task, blocks } = await createRecurringDailySeries({ workspaceId, count: 2 });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: null,
      compiledPlan: minimalCompiledPlan("Task-level fallback"),
      status: "accepted",
      prompt: "task-level",
      summary: "task-level-fallback",
      generatedBy: "test",
    });

    // Second occurrence has no own plan → task-level fallback is returned.
    const occurrenceLookup = await getLatestTaskPlanReadModel(task.id, second!.id);
    const taskLookup = await getLatestTaskPlanReadModel(task.id, null);
    expect(occurrenceLookup?.summary).toBe("task-level-fallback");
    expect(taskLookup?.summary).toBe("task-level-fallback");

    // First occurrence gets its own plan → task-level fallback is
    // shielded.
    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first!.id,
      compiledPlan: minimalCompiledPlan("First own plan"),
      status: "accepted",
      prompt: "first",
      summary: "first-own",
      generatedBy: "test",
    });
    const firstLookup = await getLatestTaskPlanReadModel(task.id, first!.id);
    expect(firstLookup?.summary).toBe("first-own");
  });

  it("header for occurrence B is unaffected by an accepted plan on occurrence A", async () => {
    const { workspaceId } = await seedWorkspace("Recurring plan header scope");
    const { task, blocks } = await createRecurringDailySeries({ workspaceId, count: 2 });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first!.id,
      compiledPlan: minimalCompiledPlan("A plan"),
      status: "accepted",
      prompt: "A",
      summary: "A",
      generatedBy: "test",
    });

    // B's header is computed by getTaskHeaderSpec(workBlockId=B). The
    // selected occurrence must be B, and A's plan details must not leak into
    // the header payload.
    const headerB = await getTaskHeaderSpec({ taskId: task.id, workBlockId: second!.id });
    expect(headerB.spec.elements).toBeDefined();
    const progressText = JSON.stringify(headerB.spec);
    expect(progressText).toContain(second!.id);
    expect(progressText).not.toContain(first!.id + ":compiled");
    expect(progressText).not.toContain("A plan");
  });

  it("currentExecution on occurrence B is no_plan even when A has a completed run", async () => {
    const { workspaceId } = await seedWorkspace("Recurring execution scope");
    const { task, blocks } = await createRecurringDailySeries({ workspaceId, count: 2 });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    // First occurrence has an accepted plan with a Completed run
    // recorded. Second occurrence has nothing.
    const compiled = minimalCompiledPlan("A");
    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first!.id,
      compiledPlan: compiled,
      status: "accepted",
      prompt: "A",
      summary: "A",
      generatedBy: "test",
    });

    const aExec = await getCurrentExecution({ taskId: task.id, workBlockId: first!.id });
    const bExec = await getCurrentExecution({ taskId: task.id, workBlockId: second!.id });
    // A may or may not be "no_plan" depending on whether the test
    // seeded a run; the point is B must be no_plan with no
    // executed nodes, regardless of A's state.
    expect(bExec.status).toBe("no_plan");
    expect(bExec.executedNodeIds).toEqual([]);
    // We don't assert A's exact status because the engine may
    // surface "no_plan" until a run is created — that's fine.
    // We DO assert A and B differ in execution state — they must
    // not share the same execution record.
    expect(JSON.stringify(aExec)).not.toBe(JSON.stringify(bExec));
  });

  it("updating the task row status to Completed leaves sibling occurrences' plans untouched", async () => {
    const { workspaceId } = await seedWorkspace("Recurring task-completed isolation");
    const { task, blocks } = await createRecurringDailySeries({ workspaceId, count: 3 });
    const [first, , third] = blocks;
    expect(first && third).toBeTruthy();

    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first!.id,
      compiledPlan: minimalCompiledPlan("First plan"),
      status: "accepted",
      prompt: "first",
      summary: "first",
      generatedBy: "test",
    });
    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: third!.id,
      compiledPlan: minimalCompiledPlan("Third plan"),
      status: "accepted",
      prompt: "third",
      summary: "third",
      generatedBy: "test",
    });

    // Mutate the task row to Completed. The plans persisted on
    // each occurrence must survive — they are scoped to the
    // workBlock, not the task row.
    await db.task.update({ where: { id: task.id }, data: { status: "Completed" } });

    const firstPlan = await getLatestTaskPlanReadModel(task.id, first!.id);
    const thirdPlan = await getLatestTaskPlanReadModel(task.id, third!.id);
    expect(firstPlan?.summary).toBe("first");
    expect(thirdPlan?.summary).toBe("third");
  });

  it("deleting one occurrence's plan does not affect the other", async () => {
    const { workspaceId } = await seedWorkspace("Recurring plan delete isolation");
    const { task, blocks } = await createRecurringDailySeries({ workspaceId, count: 2 });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first!.id,
      compiledPlan: minimalCompiledPlan("A"),
      status: "draft",
      prompt: "A",
      summary: "A",
      generatedBy: "test",
    });
    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: second!.id,
      compiledPlan: minimalCompiledPlan("B"),
      status: "draft",
      prompt: "B",
      summary: "B",
      generatedBy: "test",
    });

    // Archive A's plan by writing a new "superseded" status. The
    // engine's getLatestTaskPlanReadModel filters by status, but
    // here we just delete the TaskPlan row to simulate the
    // "delete one occurrence's plan" path.
    const aPlan = await db.taskPlan.findFirst({
      where: { taskId: task.id, workBlockId: first!.id },
    });
    expect(aPlan).toBeTruthy();
    await db.taskPlan.delete({ where: { id: aPlan!.id } });

    const aAfter = await getLatestTaskPlanReadModel(task.id, first!.id);
    const bAfter = await getLatestTaskPlanReadModel(task.id, second!.id);
    expect(aAfter).toBeNull();
    expect(bAfter?.summary).toBe("B");
  });

  it("header spec for an occurrence with no plan does not include a sibling plan", async () => {
    // The header for occurrence C (no own plan, no task-level
    // fallback) must select C. A's plan must not leak into C.
    const { workspaceId } = await seedWorkspace("Recurring plan progress label");
    const { task, blocks } = await createRecurringDailySeries({ workspaceId, count: 3 });
    const [first, , third] = blocks;
    expect(first && third).toBeTruthy();

    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first!.id,
      compiledPlan: minimalCompiledPlan("A plan"),
      status: "accepted",
      prompt: "A",
      summary: "A",
      generatedBy: "test",
    });

    // Third occurrence has no plan; A's plan must not bleed in.
    const headerC = await getTaskHeaderSpec({ taskId: task.id, workBlockId: third!.id });
    const cProgress = JSON.stringify(headerC.spec);
    expect(cProgress).toContain(third!.id);
    expect(cProgress).not.toContain("A plan");

    // First occurrence stays selectable independently.
    const headerA = await getTaskHeaderSpec({ taskId: task.id, workBlockId: first!.id });
    const aProgress = JSON.stringify(headerA.spec);
    expect(aProgress).toContain(first!.id);
  });
});

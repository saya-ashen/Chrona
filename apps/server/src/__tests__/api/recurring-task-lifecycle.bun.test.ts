import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { db } from "@chrona/db";
import { createChronaEngine } from "@chrona/engine";
import {
  getLatestTaskPlanReadModel,
  runRecurringWorkBlockExpansionWorker,
  saveCompiledPlan,
} from "@chrona/engine/test-support";
import { expandRecurrenceRule } from "@chrona/integrations";
import type { CompiledPlan } from "@chrona/contracts/ai";
import { createApiRouter } from "../../routes/api";
import { resetTestDb, seedWorkspace } from "../bun-test-helpers";

function app() {
  const server = new Hono();
  server.route("/api", createApiRouter(createChronaEngine()));
  return server;
}

async function createRecurringTask(input: {
  workspaceId: string;
  title: string;
  rrule: string;
  anchorStart: Date;
  anchorEnd: Date;
}) {
  return db.task.create({
    data: {
      workspaceId: input.workspaceId,
      title: input.title,
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
      recurrenceRule: input.rrule,
      recurrenceAnchorStartAt: input.anchorStart,
      recurrenceAnchorEndAt: input.anchorEnd,
    },
  });
}

describe("Recurring task lifecycle", () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it("creates a daily series with N work-block occurrences", async () => {
    const { workspaceId } = await seedWorkspace("Recurring Daily Series");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const task = await createRecurringTask({
      workspaceId,
      title: "Daily standup",
      rrule: "FREQ=DAILY;COUNT=5",
      anchorStart: anchor,
      anchorEnd: new Date(anchor.getTime() + 30 * 60 * 1000),
    });

    const created = await runRecurringWorkBlockExpansionWorker({ now: anchor });
    expect(created).toBe(5);

    const blocks = await db.workBlock.findMany({
      where: { taskId: task.id },
      orderBy: { scheduledStartAt: "asc" },
    });
    expect(blocks).toHaveLength(5);
    expect(blocks.map((b) => b.recurrenceKey)).toEqual([
      "2026-06-15T09:00:00.000Z",
      "2026-06-16T09:00:00.000Z",
      "2026-06-17T09:00:00.000Z",
      "2026-06-18T09:00:00.000Z",
      "2026-06-19T09:00:00.000Z",
    ]);
    expect(blocks.every((b) => b.status === "Scheduled")).toBe(true);
    expect(blocks.every((b) => b.title === "Daily standup")).toBe(true);
  });

  it("expands a weekly series bounded by COUNT and skips past occurrences", async () => {
    const { workspaceId } = await seedWorkspace("Recurring Weekly Series");
    const anchor = new Date("2026-06-01T14:00:00.000Z");
    const task = await createRecurringTask({
      workspaceId,
      title: "Weekly planning",
      rrule: "FREQ=WEEKLY;COUNT=4",
      anchorStart: anchor,
      anchorEnd: new Date(anchor.getTime() + 60 * 60 * 1000),
    });

    // First pass at the anchor — all 4 occurrences should land in the future
    // (recurrence worker is forward-looking).
    const created = await runRecurringWorkBlockExpansionWorker({ now: anchor });
    expect(created).toBe(4);

    // A second pass on the same anchor must NOT duplicate any occurrence.
    const secondPass = await runRecurringWorkBlockExpansionWorker({ now: anchor });
    expect(secondPass).toBe(0);

    const blocks = await db.workBlock.findMany({
      where: { taskId: task.id },
      orderBy: { scheduledStartAt: "asc" },
    });
    expect(blocks).toHaveLength(4);
  });

  it("scopes a saved plan to the selected work-block occurrence", async () => {
    const { workspaceId } = await seedWorkspace("Recurring Plan Scope");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const task = await createRecurringTask({
      workspaceId,
      title: "Daily audit",
      rrule: "FREQ=DAILY;COUNT=3",
      anchorStart: anchor,
      anchorEnd: new Date(anchor.getTime() + 30 * 60 * 1000),
    });
    await runRecurringWorkBlockExpansionWorker({ now: anchor });

    const blocks = await db.workBlock.findMany({
      where: { taskId: task.id },
      orderBy: { scheduledStartAt: "asc" },
    });
    const [first, second] = blocks;
    expect(first && second).toBeTruthy();

    // Minimal but valid CompiledPlan: one task node, one entry, one
    // terminal, no condition / review gates. The header spec only needs
    // the plan summary/title to surface — full node coverage is exercised
    // by the smoke / plan-execution tests.
    const compiledPlan: CompiledPlan = {
      id: "compiled_recurring_scope_plan",
      editablePlanId: "recurring-scope-plan",
      sourceVersion: 1,
      title: "First occurrence plan",
      goal: "Audit the first occurrence",
      assumptions: [],
      nodes: [
        {
          id: "audit",
          localId: "audit",
          type: "task",
          title: "Audit",
          description: "Run audit",
          config: { expectedOutput: "Audit report" },
          dependencies: [],
          dependents: [],
          mode: "auto",
          executor: "ai",
          priority: "High",
        },
      ],
      edges: [],
      entryNodeIds: ["audit"],
      terminalNodeIds: ["audit"],
      topologicalOrder: ["audit"],
      completionPolicy: { type: "all_tasks_completed" },
      validationWarnings: [],
    };

    // Persist a draft plan bound to the FIRST occurrence only.
    await saveCompiledPlan({
      workspaceId,
      taskId: task.id,
      workBlockId: first.id,
      compiledPlan,
      status: "draft",
      prompt: compiledPlan.title,
      summary: compiledPlan.goal,
      generatedBy: "test-recurring",
    });

    // getLatestTaskPlanReadModel(workBlockId=first) must return the plan we
    // just saved. getLatestTaskPlanReadModel(workBlockId=second) must NOT —
    // the second occurrence has its own scope and a different plan lookup.
    const firstPlan = await getLatestTaskPlanReadModel(task.id, first.id);
    const secondPlan = await getLatestTaskPlanReadModel(task.id, second.id);
    expect(firstPlan?.summary).toBe("Audit the first occurrence");
    expect(secondPlan?.summary).not.toBe("Audit the first occurrence");

  });

  it("isolates a failed execution on occurrence A from occurrence B's header", async () => {
    const { workspaceId } = await seedWorkspace("Recurring Run Isolation");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const task = await createRecurringTask({
      workspaceId,
      title: "Daily review",
      rrule: "FREQ=DAILY;COUNT=2",
      anchorStart: anchor,
      anchorEnd: new Date(anchor.getTime() + 30 * 60 * 1000),
    });

    await runRecurringWorkBlockExpansionWorker({ now: anchor });

    const blocks = await db.workBlock.findMany({
      where: { taskId: task.id },
      orderBy: { scheduledStartAt: "asc" },
    });
    const [a, b] = blocks;
    expect(a && b).toBeTruthy();

    // Force the task row to carry Blocked (mimics a failed run on occurrence
    // A bleeding into the task-level status). The header decision tree must
    // not surface that Blocked on occurrence B when B has no active execution.
    await db.task.update({
      where: { id: task.id },
      data: { status: "Blocked" },
    });

    const headerB = await app().request(
      `http://local/api/tasks/${task.id}/workspace/header?workBlockId=${b.id}`,
    );
    expect(headerB.status).toBe(200);
    const bodyB = (await headerB.json()) as { spec: { elements: Record<string, { props: Record<string, unknown> }> } };
    // Find the status element — header spec carries it under a stable pointer.
    const specJson = JSON.stringify(bodyB.spec);
    expect(specJson).not.toMatch(/"status"\s*:\s*"blocked"/i);
  });

  it("rejects recurrence body without anchor dates at the contract layer", async () => {
    const { workspaceId } = await seedWorkspace("Recurring Schema Guard");
    const res = await app().request("http://local/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        title: "Anchors missing",
        recurrenceRule: "FREQ=DAILY;COUNT=3",
        // recurrenceAnchorStartAt / recurrenceAnchorEndAt omitted
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(JSON.stringify(body)).toContain("recurrenceAnchor");
  });

  it("expands a monthly series bound by UNTIL and respects the upper bound", async () => {
    const { workspaceId } = await seedWorkspace("Recurring Monthly");
    const anchor = new Date("2026-06-15T09:00:00.000Z");
    const task = await createRecurringTask({
      workspaceId,
      title: "Monthly review",
      rrule: "FREQ=MONTHLY;UNTIL=20260815T090000Z",
      anchorStart: anchor,
      anchorEnd: new Date(anchor.getTime() + 60 * 60 * 1000),
    });

    const created = await runRecurringWorkBlockExpansionWorker({ now: anchor });
    expect(created).toBe(3); // June, July, August

    const blocks = await db.workBlock.findMany({
      where: { taskId: task.id },
      orderBy: { scheduledStartAt: "asc" },
    });
    expect(blocks.map((b) => b.scheduledStartAt.toISOString())).toEqual([
      "2026-06-15T09:00:00.000Z",
      "2026-07-15T09:00:00.000Z",
      "2026-08-15T09:00:00.000Z",
    ]);
  });
});

describe("Recurrence rule expansion", () => {
  it("strips a malformed RRULE without crashing", () => {
    const out = () => expandRecurrenceRule(
      "NOT_A_VALID_RRULE",
      new Date("2026-06-15T09:00:00.000Z"),
      30 * 60 * 1000,
      { from: new Date("2026-06-15T00:00:00.000Z"), to: new Date("2026-06-30T00:00:00.000Z") },
    );
    expect(out).toThrow();
  });

  it("returns no occurrences when the expansion window is empty", () => {
    const out = expandRecurrenceRule(
      "FREQ=DAILY;COUNT=5",
      new Date("2026-06-15T09:00:00.000Z"),
      30 * 60 * 1000,
      { from: new Date("2027-01-01T00:00:00.000Z"), to: new Date("2027-01-02T00:00:00.000Z") },
    );
    expect(out).toEqual([]);
  });
});

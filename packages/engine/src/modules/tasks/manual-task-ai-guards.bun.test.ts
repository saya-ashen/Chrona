import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { resetTestDb } from "@chrona/db/test-support";
import { createTask } from "./create-task";
import { taskPlanning } from "../plans/task-planning";
import { dispatchExecutionAction } from "../plan-execution/task-plan-execution";

beforeEach(resetTestDb);

describe("manual task AI guards", () => {
  it("rejects direct plan and execution entrypoints before AI records are written", async () => {
    const workspace = await db.workspace.create({ data: { name: "Manual guard", status: "Active" } });
    const created = await createTask({ workspaceId: workspace.id, title: "Direct work", taskExecutionMode: "manual" });

    await expect(taskPlanning.generate({ taskId: created.taskId, idempotencyKey: crypto.randomUUID() })).rejects.toThrow(/Manual tasks cannot use AI/);
    await expect(dispatchExecutionAction({ taskId: created.taskId, action: { action: "start_manual", idempotencyKey: crypto.randomUUID() } })).rejects.toThrow(/Manual tasks cannot use AI/);

    expect(await db.taskPlan.count({ where: { taskId: created.taskId } })).toBe(0);
    expect(await db.aiFeatureRun.count({ where: { subjectId: created.taskId } })).toBe(0);
    expect(await db.run.count({ where: { taskId: created.taskId } })).toBe(0);
    expect(await db.executionSession.count({ where: { taskId: created.taskId } })).toBe(0);
    expect(await db.taskSession.count({ where: { taskId: created.taskId } })).toBe(0);
  });
});

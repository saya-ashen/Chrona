import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { runDueScheduledWorkWorker } from "./due-scheduled-work-worker";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.workBlock.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createTask() {
  const workspace = await db.workspace.create({
    data: { name: "Due Worker", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Due task",
      status: "Ready",
      priority: "High",
      executionRuntime: "hermes",
      executionConfig: { prompt: "Run" },
    },
  });
  return { workspace, task };
}

describe("runDueScheduledWorkWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("records scheduler start, skip, and failure events from due work results", async () => {
    const { task } = await createTask();
    const startDueWork = mock(async () => ({
      started: [{ taskId: task.id, workBlockId: "block_started", runId: "plan_1" }],
      skipped: [{ taskId: task.id, workBlockId: "block_skipped", reason: "already_running" }],
      failed: [{ taskId: task.id, workBlockId: "block_failed", error: "boom" }],
      now: "2026-05-17T00:00:00.000Z",
    }));

    const result = await runDueScheduledWorkWorker({ deps: { startDueWork } });

    expect(result.started).toHaveLength(1);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.eventType)).toEqual([
      "scheduler.start",
      "scheduler.skip",
      "scheduler.fail",
    ]);
    expect(events.map((event) => event.reason)).toEqual([null, "already_running", "boom"]);
  });
});

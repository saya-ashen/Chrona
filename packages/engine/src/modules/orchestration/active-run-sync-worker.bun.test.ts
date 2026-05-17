import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { runActiveRunSyncWorker } from "./active-run-sync-worker";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function createRun() {
  const workspace = await db.workspace.create({
    data: { name: "Sync Worker", status: "Active", defaultRuntime: "openclaw" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Sync task",
      status: "Running",
      priority: "High",
      executionRuntime: "openclaw",
      executionConfig: { prompt: "Run" },
    },
  });
  const run = await db.run.create({
    data: {
      taskId: task.id,
      runtimeName: "openclaw",
      runtimeRunRef: "runtime_1",
      status: "Running",
      triggeredBy: "scheduler",
      lastSyncedAt: new Date("2026-05-17T00:00:00.000Z"),
    },
  });
  return { workspace, task, run };
}

describe("runActiveRunSyncWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("syncs stale active runs once and records scheduler events", async () => {
    const { task, run } = await createRun();
    const syncRun = mock(async () => undefined);

    const result = await runActiveRunSyncWorker({
      staleBefore: new Date("2026-05-17T00:01:00.000Z"),
      deps: { syncRun },
    });

    expect(result.synced).toEqual([{ taskId: task.id, runId: run.id }]);
    expect(syncRun).toHaveBeenCalledTimes(1);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event) => event.eventType)).toEqual(["scheduler.sync"]);
  });

  it("marks sync failures degraded and retryable", async () => {
    const { task, run } = await createRun();
    const syncRun = mock(async () => {
      throw new Error("runtime unavailable");
    });

    const result = await runActiveRunSyncWorker({ deps: { syncRun } });

    expect(result.degraded).toEqual([{ taskId: task.id, runId: run.id, error: "runtime unavailable" }]);
    const stored = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.syncStatus).toBe("degraded");
    expect(stored.retryable).toBe(true);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event) => event.eventType)).toEqual(["scheduler.fail"]);
  });
});

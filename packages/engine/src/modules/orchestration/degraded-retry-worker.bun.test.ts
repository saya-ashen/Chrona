import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { runDegradedRetryWorker } from "./degraded-retry-worker";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("runDegradedRetryWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("retries only stale degraded retryable runs", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Retry Worker", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Retry task",
        status: "Running",
        priority: "Medium",
        executionRuntime: "openclaw",
        executionConfig: { prompt: "Run" },
      },
    });
    const stale = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_stale",
        status: "Running",
        triggeredBy: "scheduler",
        syncStatus: "degraded",
        retryable: true,
        lastSyncedAt: new Date("2026-05-17T00:00:00.000Z"),
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_fresh",
        status: "Running",
        triggeredBy: "scheduler",
        syncStatus: "degraded",
        retryable: true,
        lastSyncedAt: new Date("2026-05-17T00:02:00.000Z"),
      },
    });
    const syncRun = mock(async () => undefined);

    const result = await runDegradedRetryWorker({
      now: new Date("2026-05-17T00:02:00.000Z"),
      retryAfterMs: 30_000,
      deps: { syncRun },
    });

    expect(result.retried).toEqual([{ taskId: task.id, runId: stale.id }]);
    expect(syncRun).toHaveBeenCalledTimes(1);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event) => event.eventType)).toEqual(["scheduler.degraded_retry"]);
  });
});

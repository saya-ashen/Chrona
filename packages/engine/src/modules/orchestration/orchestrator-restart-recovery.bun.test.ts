import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { runRestartRecoveryWorker } from "./restart-recovery-worker";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.schedulerLease.deleteMany();
  await db.executionSession.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("runRestartRecoveryWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes expired leases and records recovery scans", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Recovery Worker", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recovery task",
        status: "Running",
        priority: "High",
        executionRuntime: "openclaw",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.schedulerLease.create({
      data: {
        name: "expired",
        ownerId: "dead-owner",
        heartbeatAt: new Date("2026-05-17T00:00:00.000Z"),
        expiresAt: new Date("2026-05-17T00:00:01.000Z"),
      },
    });
    await db.executionSession.create({
      data: { workspaceId: workspace.id, taskId: task.id, status: "Active", planId: "plan_1" },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_degraded",
        status: "Running",
        triggeredBy: "scheduler",
        syncStatus: "degraded",
        retryable: true,
      },
    });

    const result = await runRestartRecoveryWorker({ now: new Date("2026-05-17T00:01:00.000Z") });

    expect(result).toEqual({ expiredLeaseCount: 1, activeSessionCount: 1, degradedRunCount: 1 });
    expect(await db.schedulerLease.count()).toBe(0);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event) => event.reason)).toEqual([
      "restart_active_session_scan",
      "restart_degraded_run_scan",
    ]);
  });
});

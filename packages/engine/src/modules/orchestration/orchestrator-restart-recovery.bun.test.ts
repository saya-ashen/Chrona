import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { runRestartRecoveryWorker } from "./restart-recovery-worker";

async function resetDb() {
  try {
    await db.$executeRaw`PRAGMA foreign_keys = OFF`;
    await db.taskAssistantMessage.deleteMany();
    await db.scheduleProposal.deleteMany();
    await db.toolInvocation.deleteMany();
    await db.conversationEntry.deleteMany();
    await db.runtimeCursor.deleteMany();
    await db.schedulerEvent.deleteMany();
    await db.schedulerLease.deleteMany();
    await db.reconciliationEvent.deleteMany();
    await db.graphMutationRecord.deleteMany();
    await db.graphVersion.deleteMany();
    await db.approval.deleteMany();
    await db.artifact.deleteMany();
    await db.executionSession.deleteMany();
    await db.workBlock.deleteMany();
    await db.taskProjection.deleteMany();
    await db.run.deleteMany();
    await db.taskPlanLayer.deleteMany();
    await db.taskPlanRun.deleteMany();
    await db.taskPlan.deleteMany();
    await db.taskSession.deleteMany();
    await db.taskDependency.deleteMany();
    await db.memory.deleteMany();
    await db.task.deleteMany();
    await db.workspace.deleteMany();
  } finally {
    await db.$executeRaw`PRAGMA foreign_keys = ON`;
  }
}

describe("runRestartRecoveryWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes expired leases and records recovery scans", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Recovery Worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recovery task",
        status: "Running",
        priority: "High",
        executionRuntime: "hermes",
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
    await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_1",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_1",
        planRun: {},
        executionOwnerId: "stale-owner",
        executionEpoch: 1,
        executionLeaseUntil: new Date("2026-05-17T00:00:01.000Z"),
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        runtimeRunRef: "runtime_degraded",
        status: "Running",
        triggeredBy: "scheduler",
        syncStatus: "degraded",
        retryable: true,
      },
    });

    const result = await runRestartRecoveryWorker({
      now: new Date("2026-05-17T00:01:00.000Z"),
      deps: {
        reconcileStaleRuntimeRuns: async () => ({
          checked: 0,
          synced: 0,
          leftRunning: 0,
          skipped: 0,
        }),
      },
    });

    expect(result).toEqual({
      expiredLeaseCount: 1,
      activeSessionCount: 1,
      degradedRunCount: 1,
      runtimeReconciliation: {
        checked: 0,
        synced: 0,
        leftRunning: 0,
        skipped: 0,
      },
    });
    expect(await db.schedulerLease.count()).toBe(0);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event) => event.reason)).toEqual([
      "restart_active_session_scan",
      "restart_degraded_run_scan",
    ]);
  });

  it("skips recovery records whose task was deleted", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Orphaned Recovery Worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Deleted recovery task",
        status: "Running",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.executionSession.create({
      data: { workspaceId: workspace.id, taskId: task.id, status: "Active", planId: "plan_1" },
    });
    await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_1",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_1",
        planRun: {},
        executionOwnerId: "stale-owner",
        executionEpoch: 1,
        executionLeaseUntil: new Date("2026-05-17T00:00:01.000Z"),
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        runtimeRunRef: "runtime_degraded",
        status: "Running",
        triggeredBy: "scheduler",
        syncStatus: "degraded",
        retryable: true,
      },
    });
    try {
      await db.$executeRaw`PRAGMA foreign_keys = OFF`;
      await db.task.delete({ where: { id: task.id } });
    } finally {
      await db.$executeRaw`PRAGMA foreign_keys = ON`;
    }

    const result = await runRestartRecoveryWorker({
      now: new Date("2026-05-17T00:01:00.000Z"),
      deps: {
        reconcileStaleRuntimeRuns: async () => ({
          checked: 0,
          synced: 0,
          leftRunning: 0,
          skipped: 0,
        }),
      },
    });

    expect(result).toEqual({
      expiredLeaseCount: 0,
      activeSessionCount: 0,
      degradedRunCount: 1,
      runtimeReconciliation: {
        checked: 0,
        synced: 0,
        leftRunning: 0,
        skipped: 0,
      },
    });
    expect(await db.schedulerEvent.count()).toBe(0);
  });

  it("reconciles stale runtime runs during restart recovery", async () => {
    let callCount = 0;

    const result = await runRestartRecoveryWorker({
      now: new Date("2026-05-17T00:01:00.000Z"),
      deps: {
        reconcileStaleRuntimeRuns: async (input) => {
          callCount += 1;
          expect(input).toEqual({ limit: 25 });
          return {
            checked: 2,
            synced: 1,
            leftRunning: 1,
            skipped: 0,
          };
        },
      },
    });

    expect(callCount).toBe(1);
    expect(result.runtimeReconciliation).toEqual({
      checked: 2,
      synced: 1,
      leftRunning: 1,
      skipped: 0,
    });
  });
});

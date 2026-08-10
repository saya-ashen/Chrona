import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { acquireSchedulerLease } from "./scheduler-lease-repository";
import { runGraphAdvancementWorker } from "./graph-advancement-worker";

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
    await db.schedulerLease.deleteMany();
    await db.workspace.deleteMany();
  } finally {
    await db.$executeRaw`PRAGMA foreign_keys = ON`;
  }
}

describe("runGraphAdvancementWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("starts queued tasks without active runs and records advancement", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Advance Worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Advance task",
        status: "Queued",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run" },
      },
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
      },
    });
    const startExecution = mock(async () => ({
      taskId: task.id,
      planId: "plan_1",
      mainSessionId: "session_1",
      status: "running" as const,
      currentNodeId: "node_1",
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "Running",
    }));

    const result = await runGraphAdvancementWorker({ deps: { startExecution } });

    expect(result.advanced).toEqual([{ taskId: task.id, status: "running" }]);
    expect(startExecution).toHaveBeenCalledTimes(1);
    const events = await db.schedulerEvent.findMany({ where: { taskId: task.id } });
    expect(events.map((event) => event.eventType)).toEqual(["scheduler.advance"]);
  });

  it("does not auto-advance blocked tasks awaiting manual action", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Blocked Advance Worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Blocked task",
        status: "Running",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_blocked",
        status: "Paused",
        currentNodeId: "node_blocked",
        pauseReason: "manual_action",
        completedNodeIds: "[]",
      },
    });
    const startExecution = mock(async () => ({
      taskId: task.id,
      planId: "plan_blocked",
      mainSessionId: "session_1",
      status: "running" as const,
      currentNodeId: "node_blocked",
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "Running",
    }));

    const result = await runGraphAdvancementWorker({ deps: { startExecution } });

    expect(result.advanced).toEqual([]);
    expect(startExecution).not.toHaveBeenCalled();
  });

  it("does not auto-advance stopped tasks", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Stopped Advance Worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Stopped task",
        status: "Running",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_stopped",
        status: "Abandoned",
        currentNodeId: null,
        pauseReason: "cancelled",
        completedNodeIds: "[]",
      },
    });
    const startExecution = mock(async () => ({
      taskId: task.id,
      planId: "plan_stopped",
      mainSessionId: "session_1",
      status: "running" as const,
      currentNodeId: "node_stopped",
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "Running",
    }));

    const result = await runGraphAdvancementWorker({ deps: { startExecution } });

    expect(result.advanced).toEqual([]);
    expect(startExecution).not.toHaveBeenCalled();
  });

  it("does not auto-advance a task with an active execution owner", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Owned Advance Worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Owned task",
        status: "Running",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_owned",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan_owned",
        planRun: {},
        executionOwnerId: "owner_active",
        executionOwnerScope: "manual",
      },
    });
    const startExecution = mock(async () => ({
      taskId: task.id,
      planId: "plan_owned",
      mainSessionId: "session_1",
      status: "running" as const,
      currentNodeId: "node_owned",
      executedNodeIds: [],
      waitingNodeIds: [],
      blockedNodeIds: [],
      checkpoint: null,
      message: "Running",
    }));

    const result = await runGraphAdvancementWorker({ deps: { startExecution } });

    expect(result.advanced).toEqual([]);
    expect(startExecution).not.toHaveBeenCalled();
  });
  it("does not report graph advancement after its lease is taken over during start", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Stale graph worker", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Takeover task",
        status: "Queued",
        priority: "High",
        executionRuntime: "hermes",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.taskPlan.create({
      data: { workspaceId: workspace.id, taskId: task.id, planId: "takeover_plan", revision: 1, status: "Accepted", compiledPlan: {} },
    });
    await db.taskPlanRun.create({
      data: { workspaceId: workspace.id, taskId: task.id, planId: "takeover_plan", planRun: {} },
    });
    const acquired = await acquireSchedulerLease({
      name: "graph-takeover",
      ownerId: "owner-a",
      ttlMs: 30_000,
    });
    const controller = new AbortController();
    const startExecution = mock(async () => {
      const takeover = await acquireSchedulerLease({
        name: "graph-takeover",
        ownerId: "owner-b",
        ttlMs: 30_000,
        now: new Date(Date.now() + 60_000),
      });
      expect(takeover.acquired).toBe(true);
      return {
        taskId: task.id,
        planId: "takeover_plan",
        mainSessionId: "session_1",
        status: "running" as const,
        currentNodeId: "node_1",
        executedNodeIds: [],
        waitingNodeIds: [],
        blockedNodeIds: [],
        checkpoint: null,
        message: "Running",
      };
    });

    await expect(runGraphAdvancementWorker({
      workContext: {
        signal: controller.signal,
        lease: {
          name: acquired.lease.name,
          ownerId: acquired.lease.ownerId,
          epoch: acquired.lease.epoch,
        },
        isLeaseCurrent: () => true,
      },
      deps: { startExecution },
    })).rejects.toThrow("Scheduler lease ownership was lost.");

    expect(startExecution).toHaveBeenCalledTimes(1);
    expect(await db.schedulerEvent.count({ where: { taskId: task.id } })).toBe(0);
  });
});

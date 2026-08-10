import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { recordOrchestratorEvent } from "./scheduler-events";
import { runDueScheduledWorkWorker } from "./due-scheduled-work-worker";

async function resetDb() {
  try {
    await db.$executeRaw`PRAGMA foreign_keys = OFF`;
    await db.taskAssistantMessage.deleteMany();
    await db.scheduleProposal.deleteMany();
    await db.toolInvocation.deleteMany();
    await db.conversationEntry.deleteMany();
    await db.runtimeCursor.deleteMany();
    await db.schedulerEvent.deleteMany();
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
      started: [
        { taskId: task.id, workBlockId: "block_started", runId: "plan_1" },
      ],
      skipped: [
        {
          taskId: task.id,
          workBlockId: "block_skipped",
          reasonCode: "no_accepted_plan" as const,
          reason: "Accept a plan before automatic execution can start.",
          actionable: true,
        },
      ],
      failed: [{ taskId: task.id, workBlockId: "block_failed", error: "boom" }],
      now: "2026-05-17T00:00:00.000Z",
    }));

    const result = await runDueScheduledWorkWorker({ deps: { startDueWork } });

    expect(result.started).toHaveLength(1);
    const events = await db.schedulerEvent.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "scheduler.start",
      "scheduler.skip",
      "scheduler.fail",
    ]);
    expect(events.map((event) => event.reason)).toEqual([
      null,
      "Accept a plan before automatic execution can start.",
      "boom",
    ]);
    expect(events[1]?.payload).toMatchObject({
      actionable: true,
      reasonCode: "no_accepted_plan",
      workBlockId: "block_skipped",
    });
  });

  it("does not report a due-work outcome after its lease is lost", async () => {
    const { task } = await createTask();
    const controller = new AbortController();
    const startDueWork = mock(async () => ({
      started: [{ taskId: task.id, workBlockId: "block_started", runId: "plan_1" }],
      skipped: [],
      failed: [],
      now: "2026-05-17T00:00:00.000Z",
    }));
    const recordEvent = mock(async () => undefined);

    await expect(runDueScheduledWorkWorker({
      workContext: {
        signal: controller.signal,
        lease: { name: "task-orchestrator", ownerId: "stale-owner", epoch: 1 },
        isLeaseCurrent: () => false,
      },
      deps: { recordEvent, startDueWork },
    })).rejects.toThrow("Scheduler lease ownership was lost.");

    expect(startDueWork).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("does not persist non-actionable scheduler skips", async () => {
    const { task } = await createTask();
    const startDueWork = mock(async () => ({
      started: [],
      skipped: [
        {
          taskId: task.id,
          workBlockId: "block_waiting",
          reasonCode: "not_due" as const,
          reason:
            "Automatic execution will start at the configured schedule time.",
          actionable: false,
        },
      ],
      failed: [],
      now: "2026-05-17T00:00:00.000Z",
    }));
    const recordEvent = mock(recordOrchestratorEvent);

    const result = await runDueScheduledWorkWorker({
      deps: { recordEvent, startDueWork },
    });

    expect(result.skipped).toHaveLength(1);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(await db.schedulerEvent.count()).toBe(0);
  });

  it("does not record events when no scheduled work is due", async () => {
    const startDueWork = mock(async () => ({
      started: [],
      skipped: [],
      failed: [],
      now: "2026-05-17T00:00:00.000Z",
    }));
    const recordEvent = mock(recordOrchestratorEvent);

    const result = await runDueScheduledWorkWorker({
      deps: { recordEvent, startDueWork },
    });

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(await db.schedulerEvent.count()).toBe(0);
  });

  it("ignores due work results for tasks that no longer exist", async () => {
    const startDueWork = mock(async () => ({
      started: [
        {
          taskId: "missing-task",
          workBlockId: "block_started",
          runId: "plan_1",
        },
      ],
      skipped: [
        {
          taskId: "missing-task",
          workBlockId: "block_skipped",
          reasonCode: "no_accepted_plan" as const,
          reason: "Accept a plan before automatic execution can start.",
          actionable: true,
        },
      ],
      failed: [
        { taskId: "missing-task", workBlockId: "block_failed", error: "boom" },
      ],
      now: "2026-05-17T00:00:00.000Z",
    }));
    const recordEvent = mock(recordOrchestratorEvent);

    const result = await runDueScheduledWorkWorker({
      deps: { recordEvent, startDueWork },
    });

    expect(result.started).toHaveLength(1);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(await db.schedulerEvent.count()).toBe(0);
  });
});

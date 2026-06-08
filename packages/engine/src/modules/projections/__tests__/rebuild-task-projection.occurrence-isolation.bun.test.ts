import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.executionSession.deleteMany();
  await db.run.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedRecurringTask() {
  const workspace = await db.workspace.create({
    data: { name: "Occurrence Isolation", status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: "Daily standup notes",
      status: "Running",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
      kind: "recurring",
      recurrenceRule: "FREQ=DAILY",
    },
  });
  return { workspace, task };
}

describe("rebuildTaskProjection occurrence isolation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it("does not bleed an earlier occurrence's failed run onto a later occurrence", async () => {
    const { workspace, task } = await seedRecurringTask();

    // 06-07 occurrence: a provider run failed (HTTP 502) and its session paused.
    const failedBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Completed",
        scheduledStartAt: new Date("2026-06-07T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-07T10:00:00.000Z"),
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        workBlockId: failedBlock.id,
        runtimeName: "hermes",
        triggeredBy: "scheduler",
        status: "Failed",
        errorSummary: "HTTP 502: provider fetch connect timeout",
        updatedAt: new Date("2026-06-07T09:14:38.000Z"),
      },
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: failedBlock.id,
        status: "Paused",
        currentNodeId: "draft_notes",
        pauseReason: "run_failed",
        startedAt: new Date("2026-06-07T09:00:00.000Z"),
        updatedAt: new Date("2026-06-07T09:14:38.000Z"),
      },
    });

    // 06-08 occurrence: a fresh work block, scheduled, no run/session yet.
    await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Scheduled",
        scheduledStartAt: new Date("2026-06-08T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T10:00:00.000Z"),
      },
    });

    await rebuildTaskProjection(task.id);

    // The committer scopes to the most-recently-executed occurrence (06-07), so
    // the shared projection surfaces that occurrence's real failure — never a
    // hard-coded blocked label, and never silently dropping the cause.
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.persistedStatus).toBe("Blocked");
    expect(projection.blockType).toBe("run_failed");
    expect(projection.blockDetail).toBe("HTTP 502: provider fetch connect timeout");
    expect(projection.blockNodeId).toBe("draft_notes");

    const updatedTask = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    const blockReason = updatedTask.blockReason as { blockType: string; detail?: string; nodeId?: string } | null;
    expect(blockReason?.blockType).toBe("run_failed");
    expect(blockReason?.detail).toBe("HTTP 502: provider fetch connect timeout");
    expect(blockReason?.nodeId).toBe("draft_notes");
  });

  it("clears the failure once a newer occurrence completes, without the old run poisoning it", async () => {
    const { workspace, task } = await seedRecurringTask();

    const failedBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Completed",
        scheduledStartAt: new Date("2026-06-07T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-07T10:00:00.000Z"),
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        workBlockId: failedBlock.id,
        runtimeName: "hermes",
        triggeredBy: "scheduler",
        status: "Failed",
        errorSummary: "HTTP 502: provider fetch connect timeout",
        updatedAt: new Date("2026-06-07T09:14:38.000Z"),
      },
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: failedBlock.id,
        status: "Paused",
        currentNodeId: "draft_notes",
        pauseReason: "run_failed",
        startedAt: new Date("2026-06-07T09:00:00.000Z"),
        updatedAt: new Date("2026-06-07T09:14:38.000Z"),
      },
    });

    // 06-08 occurrence executed successfully and finished later than the 06-07
    // failure. Its completed session is the most recent, so it owns the scope.
    const doneBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        title: task.title,
        status: "Completed",
        scheduledStartAt: new Date("2026-06-08T09:00:00.000Z"),
        scheduledEndAt: new Date("2026-06-08T10:00:00.000Z"),
      },
    });
    await db.run.create({
      data: {
        taskId: task.id,
        workBlockId: doneBlock.id,
        runtimeName: "hermes",
        triggeredBy: "scheduler",
        status: "Completed",
        updatedAt: new Date("2026-06-08T09:12:00.000Z"),
      },
    });
    await db.executionSession.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: doneBlock.id,
        status: "Completed",
        currentNodeId: "draft_notes",
        startedAt: new Date("2026-06-08T09:00:00.000Z"),
        updatedAt: new Date("2026-06-08T09:12:00.000Z"),
      },
    });

    await rebuildTaskProjection(task.id);

    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(projection.persistedStatus).toBe("Completed");
    expect(projection.blockType).toBeNull();
    expect(projection.blockDetail).toBeNull();
    expect(projection.blockNodeId).toBeNull();
  });
});

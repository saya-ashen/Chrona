import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { RunStatus, TaskPriority, TaskStatus, WorkspaceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createMockOpenClawAdapter } from "@chrona/openclaw-integration/runtime/mock-adapter";
import { syncTaskRunForRead } from "@/modules/runtime-sync/freshness";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolCallDetail.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.event.deleteMany();
  await db.approval.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("syncTaskRunForRead", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("can force-sync an active run even when the local snapshot is fresh", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Freshness Workspace",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Force sync current run",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_completed_1",
        runtimeSessionRef: "agent:main:dashboard:session_completed_1",
        status: RunStatus.Running,
        triggeredBy: "user",
        lastSyncedAt: new Date(),
        syncStatus: "healthy",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    await syncTaskRunForRead(task.id, createMockOpenClawAdapter({ fixtureName: "run-completed" }), {
      forceActive: true,
    });

    const storedRun = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    const projection = await db.taskProjection.findUniqueOrThrow({ where: { taskId: task.id } });

    expect(storedRun.status).toBe(RunStatus.Completed);
    expect(projection.persistedStatus).toBe("Completed");
  });
});



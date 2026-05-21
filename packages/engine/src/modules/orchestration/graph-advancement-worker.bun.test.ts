import { beforeEach, describe, expect, it, mock } from "bun:test";
import { db } from "@/lib/db";
import { runGraphAdvancementWorker } from "./graph-advancement-worker";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.run.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("runGraphAdvancementWorker", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("starts queued tasks without active runs and records advancement", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Advance Worker", status: "Active", defaultRuntime: "openclaw" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Advance task",
        status: "Queued",
        priority: "High",
        executionRuntime: "openclaw",
        executionConfig: { prompt: "Run" },
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
});

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { MemoryStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { invalidateMemory } from "@/modules/commands/invalidate-memory";
import { startRun } from "@/modules/commands/start-run";

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
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

describe("startRun", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("creates the local run before calling the adapter", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Commands",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Start a run",
        status: "Ready",
        priority: "High",
        ownerType: "human",
      },
    });

    let createRunCalls = 0;
    const adapter = {
      async createRun(input: { prompt: string }) {
        createRunCalls += 1;
        expect(input.prompt).toBe("Implement projection");

        const pendingRun = await db.run.findFirstOrThrow({
          where: { taskId: task.id },
          orderBy: { createdAt: "desc" },
        });

        expect(pendingRun.status).toBe("Pending");

        return {
          runtimeRunRef: "runtime_123",
          runtimeSessionKey: "agent:main:dashboard:runtime_123",
          runStarted: true,
        };
      },
      async getRunSnapshot() {
        throw new Error("not used in startRun test");
      },
      async readHistory() {
        throw new Error("not used in startRun test");
      },
      async listApprovals() {
        return [];
      },
      async waitForApprovalDecision() {
        return null;
      },
      async resumeRun() {
        throw new Error("not used in startRun test");
      },
    };

    const result = await startRun({
      taskId: task.id,
      prompt: "Implement projection",
      adapter,
    });

    const storedTask = await db.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { orderBy: { createdAt: "desc" } } },
    });

    expect(result.runtimeRunRef).toBe("runtime_123");
    expect(createRunCalls).toBe(1);
    expect(storedTask.latestRunId).toBe(result.runId);
    expect(storedTask.status).toBe("Running");
    expect(storedTask.runs).toHaveLength(1);
    expect(storedTask.runs[0]?.runtimeRunRef).toBe("runtime_123");
  });
});

describe("invalidateMemory", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("marks an active memory inactive and records a canonical update event", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Memory Workspace",
        status: "Active",
        defaultRuntime: "openclaw",
      },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Remember projection rules",
        status: "Running",
        priority: "High",
        ownerType: "human",
      },
    });
    const memory = await db.memory.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        content: "Use Task Projection for all list surfaces.",
        scope: "workspace",
        sourceType: "user_input",
        status: "Active",
      },
    });

    const result = await invalidateMemory({ memoryId: memory.id });

    const storedMemory = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    const memoryEvents = await db.event.findMany({
      where: { taskId: task.id, eventType: "memory.updated" },
      orderBy: { ingestSequence: "asc" },
    });

    expect(result.memoryId).toBe(memory.id);
    expect(storedMemory.status).toBe(MemoryStatus.Inactive);
    expect(memoryEvents).toHaveLength(1);
    expect(memoryEvents[0]?.payload).toEqual(
      expect.objectContaining({
        memory_id: memory.id,
        next_status: "Inactive",
        previous_status: "Active",
      }),
    );
  });
});

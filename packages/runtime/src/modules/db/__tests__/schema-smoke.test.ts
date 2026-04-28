import {
  ApprovalStatus,
  RunStatus,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";

describe("schema smoke", () => {
  beforeAll(async () => {
    await prisma.scheduleProposal.deleteMany();
    await prisma.event.deleteMany();
    await prisma.approval.deleteMany();
    await prisma.artifact.deleteMany();
    await prisma.run.deleteMany();
    await prisma.taskProjection.deleteMany();
    await prisma.taskDependency.deleteMany();
    await prisma.memory.deleteMany();
    await prisma.task.deleteMany();
    await prisma.workspace.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a task -> run -> event chain with approval and artifact references", async () => {
    const workspace = await prisma.workspace.create({
      data: { name: "MVP Workspace", status: "Active", defaultRuntime: "openclaw" },
    });

    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Draft adapter sync",
        status: TaskStatus.Ready,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const dependencySource = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Prepare runtime adapter",
        status: TaskStatus.Running,
        priority: TaskPriority.Medium,
        ownerType: "human",
      },
    });

    await prisma.taskDependency.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        dependsOnTaskId: dependencySource.id,
        dependencyType: "blocks",
      },
    });

    const run = await prisma.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.Running,
        triggeredBy: "user",
      },
    });

    await prisma.event.create({
      data: {
        eventType: "run.started",
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        actorType: "user",
        actorId: "seed-user",
        source: "ui",
        payload: { runtime_name: "openclaw" },
        dedupeKey: `run.started:${run.id}`,
        ingestSequence: 1,
      },
    });

    await prisma.approval.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "file_change",
        title: "Approve patch",
        summary: "Write task projection patch",
        riskLevel: "medium",
        status: ApprovalStatus.Pending,
        requestedAt: new Date(),
      },
    });

    await prisma.artifact.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "patch",
        title: "projection.diff",
        uri: "file:///tmp/projection.diff",
      },
    });

    const stored = await prisma.task.findUnique({
      where: { id: task.id },
      include: { runs: true, approvals: true, artifacts: true, events: true, dependencies: true },
    });

    expect(stored?.runs).toHaveLength(1);
    expect(stored?.approvals).toHaveLength(1);
    expect(stored?.artifacts).toHaveLength(1);
    expect(stored?.dependencies).toHaveLength(1);
    expect(stored?.events[0]?.eventType).toBe("run.started");
  });
});

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { terminalizePlanRunScope } from "./plan-run-terminalizer";

async function resetDb() {
  await db.taskPlanProviderApproval.deleteMany();
  await db.taskPlanProviderRun.deleteMany();
  await db.taskPlanNodeAttempt.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskOccurrence.deleteMany();
  await db.workBlock.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedScope(key: string) {
  const workspace = await db.workspace.create({
    data: { name: `Terminalizer ${key}`, status: "Active", defaultRuntime: "hermes" },
  });
  const task = await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: `Terminalizer ${key}`,
      status: "Ready",
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
    },
  });
  const workBlock = await db.workBlock.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      title: `Block ${key}`,
      status: "Active",
      scheduledStartAt: new Date("2026-06-10T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-06-10T10:00:00.000Z"),
      trigger: "scheduled",
    },
  });
  const occurrence = await db.taskOccurrence.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: workBlock.id,
      occurrenceKey: key,
      source: { kind: "test" },
      status: "Running",
      eligibleAt: new Date("2026-06-10T09:00:00.000Z"),
      startedAt: new Date("2026-06-10T09:00:00.000Z"),
    },
  });
  await db.taskPlan.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: `plan-${key}`,
      revision: 1,
      status: "Accepted",
      compiledPlan: {},
    },
  });
  const planRun = await db.taskPlanRun.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: workBlock.id,
      workBlockScopeKey: workBlock.id,
      occurrenceId: occurrence.id,
      planId: `plan-${key}`,
      planRun: { id: `run-${key}`, status: "running" },
    },
  });
  const attempt = await db.taskPlanNodeAttempt.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: `plan-${key}`,
      planRunId: planRun.id,
      nodeId: "node",
      nodeLayerId: "layer-node",
      idempotencyKey: `attempt-${key}`,
      attemptNumber: 1,
      executionEpoch: 0,
      status: "running",
      startedAt: new Date("2026-06-10T09:00:00.000Z"),
    },
  });
  const providerRun = await db.taskPlanProviderRun.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      planId: `plan-${key}`,
      planRunId: planRun.id,
      nodeAttemptId: attempt.id,
      idempotencyKey: `provider-${key}`,
      status: "waiting_for_approval",
    },
  });
  const approval = await db.taskPlanProviderApproval.create({
    data: {
      workspaceId: workspace.id,
      taskId: task.id,
      workBlockId: workBlock.id,
      planId: `plan-${key}`,
      planRunId: planRun.id,
      nodeAttemptId: attempt.id,
      providerRunId: providerRun.id,
      approvalRef: `approval-${key}`,
      provider: "hermes",
      kind: "command",
      title: "Approve",
      summary: "Approve operation",
      riskLevel: "medium",
      choices: [],
      status: "pending",
      requestedAt: new Date("2026-06-10T09:00:00.000Z"),
    },
  });
  return { task, workBlock, occurrence, planRun, approval };
}

describe("plan run terminalizer", () => {
  beforeEach(resetDb);
  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("clears only approvals and the explicit occurrence in the terminal scope", async () => {
    const first = await seedScope("first");
    const second = await seedScope("second");

    await terminalizePlanRunScope({
      taskId: first.task.id,
      workBlockId: first.workBlock.id,
      planRunId: first.planRun.id,
      occurrenceId: first.occurrence.id,
      status: RunStatus.Completed,
    });

    expect(await db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: first.approval.id } })).toMatchObject({
      status: "superseded",
      resolvedBy: "system",
      resolvedAt: expect.any(Date),
    });
    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: first.occurrence.id } })).toMatchObject({
      status: "Completed",
      completedAt: expect.any(Date),
    });
    expect(await db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: second.approval.id } })).toMatchObject({
      status: "pending",
      resolvedAt: null,
    });
    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: second.occurrence.id } })).toMatchObject({
      status: "Running",
      completedAt: null,
    });
  });

  it("is idempotent and does not rewrite resolved approvals or terminal occurrence timestamps", async () => {
    const scope = await seedScope("retry");
    const input = {
      taskId: scope.task.id,
      workBlockId: scope.workBlock.id,
      planRunId: scope.planRun.id,
      occurrenceId: scope.occurrence.id,
      status: RunStatus.Failed,
    };

    await terminalizePlanRunScope(input);
    const firstApproval = await db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: scope.approval.id } });
    const firstOccurrence = await db.taskOccurrence.findUniqueOrThrow({ where: { id: scope.occurrence.id } });

    await terminalizePlanRunScope(input);

    expect(await db.taskPlanProviderApproval.findUniqueOrThrow({ where: { id: scope.approval.id } })).toMatchObject({
      status: "superseded",
      resolvedAt: firstApproval.resolvedAt,
    });
    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: scope.occurrence.id } })).toMatchObject({
      status: "Failed",
      completedAt: firstOccurrence.completedAt,
    });
  });
});

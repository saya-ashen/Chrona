import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getInbox } from "@/modules/pages/get-inbox";

async function resetDb() {
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
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

async function seedTask(workspaceId: string, title: string, status: string, extra: Record<string, unknown> = {}) {
  return db.task.create({
    data: {
      workspaceId,
      title,
      status: status as never,
      priority: "Medium",
      executionRuntime: "hermes",
      executionConfig: {},
      ...extra,
    },
  });
}

async function seedRun(taskId: string, status: string, extra: Record<string, unknown> = {}) {
  return db.run.create({
    data: {
      taskId,
      runtimeName: "hermes",
      status: status as never,
      triggeredBy: "manual",
      ...extra,
    },
  });
}

describe("getInbox actionable states", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it("emits exactly one actionable item per paused/terminal state", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Inbox WS", status: "Active", defaultRuntime: "hermes" },
    });

    // WaitingForApproval -> pending Approval row (kind:"approval").
    const approvalTask = await seedTask(workspace.id, "Approval task", "WaitingForApproval");
    const approvalRun = await seedRun(approvalTask.id, "WaitingForApproval", { runtimeRunRef: "run-approval" });
    await db.approval.create({
      data: {
        workspaceId: workspace.id,
        taskId: approvalTask.id,
        runId: approvalRun.id,
        type: "command",
        title: "Approve command",
        summary: "Run a shell command",
        riskLevel: "high",
        status: "Pending",
        requestedAt: new Date(),
      },
    });

    // WaitingForInput -> latest run waiting (kind:"input").
    const inputTask = await seedTask(workspace.id, "Input task", "WaitingForInput");
    const inputRun = await seedRun(inputTask.id, "WaitingForInput", {
      runtimeRunRef: "run-input",
      pendingInputPrompt: "Which environment should I target?",
    });
    await db.task.update({ where: { id: inputTask.id }, data: { latestRunId: inputRun.id } });

    // Failed -> latest run failed (kind:"recovery").
    const failedTask = await seedTask(workspace.id, "Failed task", "Failed");
    const failedRun = await seedRun(failedTask.id, "Failed", { runtimeRunRef: "run-failed" });
    await db.task.update({ where: { id: failedTask.id }, data: { latestRunId: failedRun.id } });

    // Cancelled -> latest run cancelled (kind:"recovery").
    const cancelledTask = await seedTask(workspace.id, "Cancelled task", "Cancelled");
    const cancelledRun = await seedRun(cancelledTask.id, "Cancelled", { runtimeRunRef: "run-cancelled" });
    await db.task.update({ where: { id: cancelledTask.id }, data: { latestRunId: cancelledRun.id } });

    // Blocked -> task status Blocked, no covering run item (kind:"blocked").
    const blockedTask = await seedTask(workspace.id, "Blocked task", "Blocked", {
      blockReason: {
        blockType: "capability_unavailable",
        scope: "runtime",
        actionRequired: "Check provider availability",
        detail: "Provider hermes is offline.",
      },
    });

    const items = await getInbox(workspace.id);

    const byTask = (taskId: string) => items.filter((item) => item.sourceTaskId === taskId);

    const approvalItems = byTask(approvalTask.id);
    expect(approvalItems).toHaveLength(1);
    expect(approvalItems[0]?.kind).toBe("approval");
    expect(approvalItems[0]?.summary).toBeTruthy();

    const inputItems = byTask(inputTask.id);
    expect(inputItems).toHaveLength(1);
    expect(inputItems[0]?.kind).toBe("input");
    expect(inputItems[0]?.summary).toBe("Which environment should I target?");

    const failedItems = byTask(failedTask.id);
    expect(failedItems).toHaveLength(1);
    expect(failedItems[0]?.kind).toBe("recovery");
    expect(failedItems[0]?.summary).toBeTruthy();

    const cancelledItems = byTask(cancelledTask.id);
    expect(cancelledItems).toHaveLength(1);
    expect(cancelledItems[0]?.kind).toBe("recovery");
    expect(cancelledItems[0]?.summary).toBeTruthy();

    const blockedItems = byTask(blockedTask.id);
    expect(blockedItems).toHaveLength(1);
    expect(blockedItems[0]?.kind).toBe("blocked");
    expect(blockedItems[0]?.summary).toBe("Provider hermes is offline.");
    expect(blockedItems[0]?.sourceTaskId).toBe(blockedTask.id);
  });

  it("does not double-count a Blocked task whose latest run already produced a recovery item", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Inbox dedup WS", status: "Active", defaultRuntime: "hermes" },
    });

    const task = await seedTask(workspace.id, "Blocked + failed run", "Blocked", {
      blockReason: { blockType: "run_failed", scope: "run", actionRequired: "Retry Run" },
    });
    const run = await seedRun(task.id, "Failed", { runtimeRunRef: "run-dedup" });
    await db.task.update({ where: { id: task.id }, data: { latestRunId: run.id } });

    const items = await getInbox(workspace.id);
    const forTask = items.filter((item) => item.sourceTaskId === task.id);

    expect(forTask).toHaveLength(1);
    expect(forTask[0]?.kind).toBe("recovery");
  });

  it("falls back to a sensible reason when blockReason shape is unexpected", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Inbox fallback WS", status: "Active", defaultRuntime: "hermes" },
    });

    const task = await seedTask(workspace.id, "Blocked no reason", "Blocked", { blockReason: null });

    const items = await getInbox(workspace.id);
    const blocked = items.find((item) => item.sourceTaskId === task.id);

    expect(blocked?.kind).toBe("blocked");
    expect(blocked?.summary).toBeTruthy();
  });
});

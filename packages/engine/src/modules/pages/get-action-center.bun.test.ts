import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { getActionCenter } from "@/modules/pages/get-action-center";

async function resetDb() {
  await db.taskTimelineItem.deleteMany();
  await db.schedulerEvent.deleteMany();
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

describe("getActionCenter actionable states", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
  });

  it("emits exactly one actionable item per paused/terminal state", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Action Center WS", status: "Active", defaultRuntime: "hermes" },
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

    const items = await getActionCenter(workspace.id);

    const byTask = (taskId: string) => items.filter((item) => item.sourceTaskId === taskId);

    const approvalItems = byTask(approvalTask.id);
    expect(approvalItems).toHaveLength(1);
    expect(approvalItems[0]?.kind).toBe("approval");
    expect(approvalItems[0]?.summary).toBeTruthy();

    const inputItems = byTask(inputTask.id);
    expect(inputItems).toHaveLength(1);
    expect(inputItems[0]?.kind).toBe("input");
    expect(inputItems[0]?.summary).toBe("Which environment should I target?");
    expect(inputItems[0]?.actionType).toBe("Input needed");
    expect(inputItems[0]?.consequence).toBe("Provide the requested input so execution can continue");

    const failedItems = byTask(failedTask.id);
    expect(failedItems).toHaveLength(1);
    expect(failedItems[0]?.kind).toBe("recovery");
    expect(failedItems[0]?.summary).toBeTruthy();
    expect(failedItems[0]?.actionType).toBe("Failed");
    expect(failedItems[0]?.consequence).toBe("Review the failure reason, then retry or stop");

    const cancelledItems = byTask(cancelledTask.id);
    expect(cancelledItems).toHaveLength(1);
    expect(cancelledItems[0]?.kind).toBe("recovery");
    expect(cancelledItems[0]?.summary).toBeTruthy();
    expect(cancelledItems[0]?.actionType).toBe("Cancelled");
    expect(cancelledItems[0]?.consequence).toBe("Inspect the audit trail or reopen the task");

    const blockedItems = byTask(blockedTask.id);
    expect(blockedItems).toHaveLength(1);
    expect(blockedItems[0]?.kind).toBe("blocked");
    expect(blockedItems[0]?.summary).toBe("Provider hermes is offline.");
    expect(blockedItems[0]?.sourceTaskId).toBe(blockedTask.id);
  });

  it("does not double-count a Blocked task whose latest run already produced a recovery item", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Action Center dedup WS", status: "Active", defaultRuntime: "hermes" },
    });

    const task = await seedTask(workspace.id, "Blocked + failed run", "Blocked", {
      blockReason: { blockType: "run_failed", scope: "run", actionRequired: "Retry Run" },
    });
    const run = await seedRun(task.id, "Failed", { runtimeRunRef: "run-dedup" });
    await db.task.update({ where: { id: task.id }, data: { latestRunId: run.id } });

    const items = await getActionCenter(workspace.id);
    const forTask = items.filter((item) => item.sourceTaskId === task.id);

    expect(forTask).toHaveLength(1);
    expect(forTask[0]?.kind).toBe("recovery");
  });

  it("falls back to a sensible reason when blockReason shape is unexpected", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Action Center fallback WS", status: "Active", defaultRuntime: "hermes" },
    });

    const task = await seedTask(workspace.id, "Blocked no reason", "Blocked", { blockReason: null });

    const items = await getActionCenter(workspace.id);
    const blocked = items.find((item) => item.sourceTaskId === task.id);

    expect(blocked?.kind).toBe("blocked");
    expect(blocked?.summary).toBeTruthy();
  });

  it("emits bounded notification items for due tasks, scheduler events, completed runs, and info timeline", async () => {
    const now = new Date();
    const minutesFromNow = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const workspace = await db.workspace.create({
      data: { name: "Action Center notification WS", status: "Active", defaultRuntime: "hermes" },
    });

    const overdueTask = await seedTask(workspace.id, "Overdue task", "Scheduled", { dueAt: minutesFromNow(-60) });
    const dueNowTask = await seedTask(workspace.id, "Due now task", "Ready", { dueAt: minutesFromNow(5) });
    const dueSoonTask = await seedTask(workspace.id, "Due soon task", "Ready", { dueAt: minutesFromNow(120) });
    await seedTask(workspace.id, "Old overdue task", "Ready", { dueAt: minutesFromNow(-8 * 24 * 60) });
    await seedTask(workspace.id, "Far future task", "Ready", { dueAt: minutesFromNow(25 * 60) });
    await seedTask(workspace.id, "Closed due task", "Completed", { dueAt: minutesFromNow(5) });

    const autoStartedTask = await seedTask(workspace.id, "Auto started task", "Running");
    const autoSkippedTask = await seedTask(workspace.id, "Auto skipped task", "Scheduled");
    const oldAutoTask = await seedTask(workspace.id, "Old auto task", "Scheduled");
    await db.schedulerEvent.create({
      data: { workspaceId: workspace.id, taskId: autoStartedTask.id, eventType: "scheduler.start", createdAt: minutesFromNow(-10) },
    });
    await db.schedulerEvent.create({
      data: { workspaceId: workspace.id, taskId: autoSkippedTask.id, eventType: "scheduler.skip", reason: "outside_window", createdAt: minutesFromNow(-20) },
    });
    await db.schedulerEvent.create({
      data: { workspaceId: workspace.id, taskId: oldAutoTask.id, eventType: "scheduler.start", createdAt: minutesFromNow(-25 * 60) },
    });

    const completedTask = await seedTask(workspace.id, "Completed run task", "Completed");
    await seedRun(completedTask.id, "Completed", { runtimeRunRef: "run-old-completed", endedAt: minutesFromNow(-50), updatedAt: minutesFromNow(-50) });
    const latestCompletedRun = await seedRun(completedTask.id, "Completed", { runtimeRunRef: "run-new-completed", endedAt: minutesFromNow(-5), updatedAt: minutesFromNow(-5) });
    await db.task.update({ where: { id: completedTask.id }, data: { latestRunId: latestCompletedRun.id } });
    const staleCompletedTask = await seedTask(workspace.id, "Stale completed run task", "Failed");
    await seedRun(staleCompletedTask.id, "Completed", { runtimeRunRef: "run-stale-completed", endedAt: minutesFromNow(-8), updatedAt: minutesFromNow(-8) });
    const newerFailedRun = await seedRun(staleCompletedTask.id, "Failed", { runtimeRunRef: "run-newer-failed", updatedAt: minutesFromNow(-2) });
    await db.task.update({ where: { id: staleCompletedTask.id }, data: { latestRunId: newerFailedRun.id } });
    const oldCompletedTask = await seedTask(workspace.id, "Old completed run task", "Completed");
    await seedRun(oldCompletedTask.id, "Completed", { runtimeRunRef: "run-too-old-completed", endedAt: minutesFromNow(-25 * 60), updatedAt: minutesFromNow(-25 * 60) });

    const infoTask = await seedTask(workspace.id, "Info task", "Ready");
    await db.taskTimelineItem.create({
      data: {
        workspaceId: workspace.id,
        taskId: infoTask.id,
        kind: "notification.info",
        title: "Heads up",
        body: "Background sync finished.",
        severity: "warning",
        sortTime: minutesFromNow(-3),
      },
    });

    const items = await getActionCenter(workspace.id);
    const byTask = (taskId: string) => items.filter((item) => item.sourceTaskId === taskId);

    expect(byTask(overdueTask.id).map((item) => item.kind)).toEqual(["task_overdue"]);
    expect(byTask(dueNowTask.id).map((item) => item.kind)).toEqual(["task_due_now"]);
    expect(byTask(dueSoonTask.id).map((item) => item.kind)).toEqual(["task_due_soon"]);
    expect(items.some((item) => item.sourceTaskTitle === "Old overdue task")).toBe(false);
    expect(items.some((item) => item.sourceTaskTitle === "Far future task")).toBe(false);
    expect(items.some((item) => item.sourceTaskTitle === "Closed due task")).toBe(false);

    expect(byTask(autoStartedTask.id).map((item) => item.kind)).toEqual(["auto_execution_started"]);
    expect(byTask(autoSkippedTask.id).map((item) => item.kind)).toEqual(["auto_execution_skipped"]);
    expect(items.some((item) => item.sourceTaskId === oldAutoTask.id)).toBe(false);

    expect(byTask(completedTask.id)).toHaveLength(1);
    expect(byTask(completedTask.id)[0]).toMatchObject({ kind: "execution_completed", currentRunLabel: latestCompletedRun.runtimeRunRef });
    expect(items.some((item) => item.sourceTaskId === oldCompletedTask.id)).toBe(false);
    expect(byTask(staleCompletedTask.id).map((item) => item.kind)).toEqual(["recovery"]);

    expect(byTask(infoTask.id)[0]).toMatchObject({
      kind: "notification_info",
      actionType: "Heads up",
      riskLevel: "medium",
      summary: "Background sync finished.",
    });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@chrona/db";
import { getActionCenter } from "@chrona/engine/test-support";

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
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.run.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.task.deleteMany();
  await db.workspace.deleteMany();
}

async function seedTask(
  workspaceId: string,
  title: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  return db.task.create({
    data: {
      workspaceId,
      title,
      status: status as never,
      priority: "Medium",
      executionConfig: {},
      ...extra,
    },
  });
}

async function seedRun(
  taskId: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
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
      data: {
        name: "Action Center WS",
        status: "Active",
      },
    });

    // WaitingForApproval -> pending Approval row (kind:"approval").
    const approvalTask = await seedTask(
      workspace.id,
      "Approval task",
      "WaitingForApproval",
    );
    const approvalRun = await seedRun(approvalTask.id, "WaitingForApproval", {
      runtimeRunRef: "run-approval",
    });
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

    // WaitingForInput task can retain a Running canonical Run while its graph waits.
    const inputTask = await seedTask(
      workspace.id,
      "Input task",
      "WaitingForInput",
    );
    const inputRun = await seedRun(inputTask.id, "Running", {
      runtimeRunRef: "run-input",
      pendingInputPrompt: "Which environment should I target?",
    });
    await db.task.update({
      where: { id: inputTask.id },
      data: { latestRunId: inputRun.id },
    });

    // Failed -> latest run failed (kind:"recovery").
    const failedTask = await seedTask(workspace.id, "Failed task", "Failed");
    const failedRun = await seedRun(failedTask.id, "Failed", {
      runtimeRunRef: "run-failed",
    });
    await db.task.update({
      where: { id: failedTask.id },
      data: { latestRunId: failedRun.id },
    });

    // Cancelled -> latest run cancelled (kind:"recovery").
    const cancelledTask = await seedTask(
      workspace.id,
      "Cancelled task",
      "Cancelled",
    );
    const cancelledRun = await seedRun(cancelledTask.id, "Cancelled", {
      runtimeRunRef: "run-cancelled",
    });
    await db.task.update({
      where: { id: cancelledTask.id },
      data: { latestRunId: cancelledRun.id },
    });

    // Blocked -> task status Blocked, no covering run item (kind:"blocked").
    const blockedTask = await seedTask(
      workspace.id,
      "Blocked task",
      "Blocked",
      {
        blockReason: {
          blockType: "capability_unavailable",
          scope: "runtime",
          actionRequired: "Check provider availability",
          detail: "Provider hermes is offline.",
        },
      },
    );

    const items = await getActionCenter(workspace.id);

    const byTask = (taskId: string) =>
      items.filter((item) => item.sourceTaskId === taskId);

    const approvalItems = byTask(approvalTask.id);
    expect(approvalItems).toHaveLength(1);
    expect(approvalItems[0]?.kind).toBe("approval");
    expect(approvalItems[0]?.summary).toBeTruthy();

    const inputItems = byTask(inputTask.id);
    expect(inputItems).toHaveLength(1);
    expect(inputItems[0]?.kind).toBe("input");
    expect(inputItems[0]?.summary).toBe("Which environment should I target?");
    expect(inputItems[0]?.actionType).toBe("Input needed");
    expect(inputItems[0]?.consequence).toBe(
      "Provide the requested input so execution can continue",
    );

    const failedItems = byTask(failedTask.id);
    expect(failedItems).toHaveLength(1);
    expect(failedItems[0]?.kind).toBe("recovery");
    expect(failedItems[0]?.summary).toBeTruthy();
    expect(failedItems[0]?.actionType).toBe("Failed");
    expect(failedItems[0]?.consequence).toBe(
      "Review the failure reason, then retry or stop",
    );

    const cancelledItems = byTask(cancelledTask.id);
    expect(cancelledItems).toHaveLength(1);
    expect(cancelledItems[0]?.kind).toBe("recovery");
    expect(cancelledItems[0]?.summary).toBeTruthy();
    expect(cancelledItems[0]?.actionType).toBe("Cancelled");
    expect(cancelledItems[0]?.consequence).toBe(
      "Inspect the audit trail or reopen the task",
    );

    const blockedItems = byTask(blockedTask.id);
    expect(blockedItems).toHaveLength(1);
    expect(blockedItems[0]?.kind).toBe("blocked");
    expect(blockedItems[0]?.summary).toBe("Provider hermes is offline.");
    expect(blockedItems[0]?.sourceTaskId).toBe(blockedTask.id);
  });

  it("projects a persisted plan-run approval without a legacy Approval row", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Action Center plan-run approval",
        status: "Active",
      },
    });
    const task = await seedTask(
      workspace.id,
      "Approve generated output",
      "WaitingForApproval",
      { dueAt: new Date() },
    );
    const run = await seedRun(task.id, "Completed", {
      runtimeRunRef: "run-waiting-for-approval",
    });
    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });
    await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan-action-center-approval",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    const planRun = await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan-action-center-approval",
        planRun: {
          mutableGraph: {
            results: [
              {
                nodeId: "review-output",
                status: "current",
                waitKind: "approval",
                review: { required: true, status: "pending" },
                error: "Approve the generated output before publishing.",
              },
            ],
          },
        },
      },
    });

    const items = await getActionCenter(workspace.id);
    const taskItems = items.filter((item) => item.sourceTaskId === task.id);

    expect(taskItems).toHaveLength(1);
    expect(taskItems[0]).toMatchObject({
      id: planRun.id,
      kind: "approval",
      actionType: "Approval needed",
      riskLevel: "high",
      currentRunLabel: planRun.id,
      summary: "Approve the generated output before publishing.",
      consequence: "Approve or reject the current execution checkpoint",
    });
  });

  it("surfaces a completed graph result when no legacy Run row exists", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Action Center graph result", status: "Active" },
    });
    const task = await seedTask(workspace.id, "Graph-only completed task", "Completed");
    const planId = "plan-action-center-graph-result";
    await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId,
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    const planRun = await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId,
        planRun: {
          planRun: { status: "completed" },
          mutableGraph: {
            planOutput: {
              finalization: { status: "Ready" },
            },
          },
        },
      },
    });

    const taskItems = (await getActionCenter(workspace.id)).filter(
      (item) => item.sourceTaskId === task.id,
    );
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0]).toMatchObject({
      id: `execution-completed:${planRun.id}`,
      kind: "execution_completed",
      currentRunLabel: planRun.id,
    });
  });

  it("does not resurrect waiting plan-run actions for Completed, Done, or Cancelled tasks", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Action Center closed task plan runs",
        status: "Active",
      },
    });

    for (const [index, status] of ["Completed", "Done", "Cancelled"].entries()) {
      const task = await seedTask(
        workspace.id,
        `Closed task ${status}`,
        status,
      );
      const staleApprovalRun = await seedRun(task.id, "WaitingForApproval");
      await db.approval.create({
        data: {
          workspaceId: workspace.id,
          taskId: task.id,
          runId: staleApprovalRun.id,
          type: "stale_closed_task",
          title: "Stale approval",
          summary: "This stale approval must stay hidden.",
          riskLevel: "high",
          status: "Pending",
          requestedAt: new Date(),
        },
      });
      await db.scheduleProposal.create({
        data: {
          workspaceId: workspace.id,
          taskId: task.id,
          source: "ai",
          status: "Pending",
          proposedBy: "agent:test",
          summary: "This stale proposal must stay hidden.",
        },
      });

      const planId = `plan-closed-${index}`;
      await db.taskPlan.create({
        data: {
          workspaceId: workspace.id,
          taskId: task.id,
          planId,
          revision: 1,
          status: "Accepted",
          compiledPlan: {},
        },
      });
      await db.taskPlanRun.create({
        data: {
          workspaceId: workspace.id,
          taskId: task.id,
          planId,
          planRun: {
            mutableGraph: {
              results: [
                {
                  nodeId: "stale-input",
                  status: "current",
                  waitKind: "user_input",
                  error: "This stale action must stay hidden.",
                },
              ],
            },
          },
        },
      });
    }

    expect(await getActionCenter(workspace.id)).toEqual([]);
  });

  it("does not double-count a Blocked task whose latest run already produced a recovery item", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Action Center dedup WS",
        status: "Active",
      },
    });

    const task = await seedTask(
      workspace.id,
      "Blocked + failed run",
      "Blocked",
      {
        blockReason: {
          blockType: "run_failed",
          scope: "run",
          actionRequired: "Retry Run",
        },
      },
    );
    const run = await seedRun(task.id, "Failed", {
      runtimeRunRef: "run-dedup",
    });
    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });
    await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan-action-center-recovery",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "plan-action-center-recovery",
        planRun: {
          planRun: {
            status: "failed",
            nodeStates: {
              retry_node: { nodeId: "retry_node", status: "failed" },
            },
          },
        },
      },
    });

    const items = await getActionCenter(workspace.id);
    const forTask = items.filter((item) => item.sourceTaskId === task.id);

    expect(forTask).toHaveLength(1);
    expect(forTask[0]).toMatchObject({
      kind: "recovery",
      currentNodeId: "retry_node",
    });
  });

  it("keeps recurring occurrence actions and failed nodes scoped to their work block", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Action Center recurring scopes",
        status: "Active",
      },
    });
    const task = await seedTask(workspace.id, "Recurring task", "Blocked", {
      blockReason: { blockType: "run_failed", scope: "run" },
    });
    const scheduledStartAt = new Date("2030-01-01T09:00:00.000Z");
    const scheduledEndAt = new Date("2030-01-01T10:00:00.000Z");
    const blockA = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        recurrenceKey: "occurrence-a",
        title: "Occurrence A",
        scheduledStartAt,
        scheduledEndAt,
      },
    });
    const blockB = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        recurrenceKey: "occurrence-b",
        title: "Occurrence B",
        scheduledStartAt,
        scheduledEndAt,
      },
    });
    const failedRun = await seedRun(task.id, "Failed", {
      runtimeRunRef: "run-occurrence-a",
      workBlockId: blockA.id,
    });
    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: failedRun.id },
    });

    await db.taskPlan.createMany({
      data: [
        {
          workspaceId: workspace.id,
          taskId: task.id,
          workBlockId: blockA.id,
          planId: "plan-occurrence-a",
          revision: 1,
          status: "Accepted",
          compiledPlan: {},
        },
        {
          workspaceId: workspace.id,
          taskId: task.id,
          workBlockId: blockB.id,
          planId: "plan-occurrence-b",
          revision: 1,
          status: "Accepted",
          compiledPlan: {},
        },
      ],
    });
    await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: blockA.id,
        workBlockScopeKey: blockA.id,
        planId: "plan-occurrence-a",
        planRun: {
          planRun: {
            status: "failed",
            nodeStates: {
              node_a: { nodeId: "node_a", status: "failed" },
            },
          },
        },
      },
    });
    const waitingRun = await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        workBlockId: blockB.id,
        workBlockScopeKey: blockB.id,
        planId: "plan-occurrence-b",
        planRun: {
          planRun: {
            status: "failed",
            nodeStates: {
              node_b: { nodeId: "node_b", status: "failed" },
            },
          },
          mutableGraph: {
            results: [
              {
                nodeId: "input_b",
                status: "current",
                waitKind: "user_input",
                error: "Provide input for occurrence B.",
              },
            ],
          },
        },
      },
    });

    const items = (await getActionCenter(workspace.id)).filter(
      (item) => item.sourceTaskId === task.id,
    );

    expect(items).toHaveLength(2);
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: "recovery",
        currentNodeId: "node_a",
        workBlockId: blockA.id,
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: waitingRun.id,
        kind: "input",
        workBlockId: blockB.id,
        summary: "Provide input for occurrence B.",
      }),
    );
  });

  it("falls back to a sensible reason when blockReason shape is unexpected", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Action Center fallback WS",
        status: "Active",
      },
    });

    const task = await seedTask(workspace.id, "Blocked no reason", "Blocked", {
      blockReason: null,
    });

    const items = await getActionCenter(workspace.id);
    const blocked = items.find((item) => item.sourceTaskId === task.id);

    expect(blocked?.kind).toBe("blocked");
    expect(blocked?.summary).toBeTruthy();
  });

  it("removes a completed-result review item after the latest result is accepted", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Accepted result Action Center", status: "Active" },
    });
    const task = await seedTask(
      workspace.id,
      "Accepted result task",
      "Completed",
    );
    const run = await seedRun(task.id, "Completed", {
      runtimeRunRef: "accepted-result-run",
      endedAt: new Date(),
      updatedAt: new Date(),
    });
    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    expect(
      (await getActionCenter(workspace.id)).some(
        (item) =>
          item.sourceTaskId === task.id && item.kind === "execution_completed",
      ),
    ).toBe(true);

    await db.event.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        eventType: "task.result_accepted",
        actorType: "user",
        source: "ui",
        payload: { accepted_run_id: run.id },
        ingestSequence: 1,
      },
    });

    expect(
      (await getActionCenter(workspace.id)).some(
        (item) =>
          item.sourceTaskId === task.id && item.kind === "execution_completed",
      ),
    ).toBe(false);
  });

  it("emits bounded notification items for due tasks, scheduler events, completed runs, and info timeline", async () => {
    const now = new Date();
    const minutesFromNow = (minutes: number) =>
      new Date(now.getTime() + minutes * 60_000);
    const workspace = await db.workspace.create({
      data: {
        name: "Action Center notification WS",
        status: "Active",
      },
    });

    const overdueTask = await seedTask(
      workspace.id,
      "Overdue task",
      "Scheduled",
      { dueAt: minutesFromNow(-60) },
    );
    const dueNowTask = await seedTask(workspace.id, "Due now task", "Ready", {
      dueAt: minutesFromNow(5),
    });
    const dueSoonTask = await seedTask(workspace.id, "Due soon task", "Ready", {
      dueAt: minutesFromNow(120),
    });
    await seedTask(workspace.id, "Old overdue task", "Ready", {
      dueAt: minutesFromNow(-8 * 24 * 60),
    });
    await seedTask(workspace.id, "Far future task", "Ready", {
      dueAt: minutesFromNow(25 * 60),
    });
    await seedTask(workspace.id, "Closed due task", "Completed", {
      dueAt: minutesFromNow(5),
    });

    const autoStartedTask = await seedTask(
      workspace.id,
      "Auto started task",
      "Running",
    );
    const autoSkippedTask = await seedTask(
      workspace.id,
      "Auto skipped task",
      "Scheduled",
    );
    const oldAutoTask = await seedTask(
      workspace.id,
      "Old auto task",
      "Scheduled",
    );
    await db.schedulerEvent.create({
      data: {
        workspaceId: workspace.id,
        taskId: autoStartedTask.id,
        eventType: "scheduler.start",
        createdAt: minutesFromNow(-10),
      },
    });
    await db.schedulerEvent.createMany({
      data: [
        {
          workspaceId: workspace.id,
          taskId: autoSkippedTask.id,
          eventType: "scheduler.skip",
          reason: "Accept a plan before automatic execution can start.",
          payload: {
            actionable: true,
            reasonCode: "no_accepted_plan",
            workBlockId: "block-actionable",
          },
          createdAt: minutesFromNow(-20),
        },
        {
          workspaceId: workspace.id,
          taskId: autoSkippedTask.id,
          eventType: "scheduler.skip",
          reason: "Accept a plan before automatic execution can start.",
          payload: {
            actionable: true,
            reasonCode: "no_accepted_plan",
            workBlockId: "block-actionable",
          },
          createdAt: minutesFromNow(-15),
        },
        {
          workspaceId: workspace.id,
          taskId: autoSkippedTask.id,
          eventType: "scheduler.skip",
          reason:
            "Automatic execution will start at the configured schedule time.",
          createdAt: minutesFromNow(-10),
        },
      ],
    });

    const completedTask = await seedTask(
      workspace.id,
      "Completed run task",
      "Completed",
    );
    const completedBlock = await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: completedTask.id,
        recurrenceKey: "completed-occurrence",
        title: "Completed occurrence",
        scheduledStartAt: minutesFromNow(-30),
        scheduledEndAt: minutesFromNow(30),
      },
    });
    await seedRun(completedTask.id, "Completed", {
      runtimeRunRef: "run-old-completed",
      endedAt: minutesFromNow(-50),
      updatedAt: minutesFromNow(-50),
    });
    const latestCompletedRun = await seedRun(completedTask.id, "Completed", {
      runtimeRunRef: "run-new-completed",
      workBlockId: completedBlock.id,
      endedAt: minutesFromNow(-5),
      updatedAt: minutesFromNow(-5),
    });
    await db.task.update({
      where: { id: completedTask.id },
      data: { latestRunId: latestCompletedRun.id },
    });
    const staleCompletedTask = await seedTask(
      workspace.id,
      "Stale completed run task",
      "Failed",
    );
    await seedRun(staleCompletedTask.id, "Completed", {
      runtimeRunRef: "run-stale-completed",
      endedAt: minutesFromNow(-8),
      updatedAt: minutesFromNow(-8),
    });
    const newerFailedRun = await seedRun(staleCompletedTask.id, "Failed", {
      runtimeRunRef: "run-newer-failed",
      updatedAt: minutesFromNow(-2),
    });
    await db.task.update({
      where: { id: staleCompletedTask.id },
      data: { latestRunId: newerFailedRun.id },
    });
    const oldCompletedTask = await seedTask(
      workspace.id,
      "Old completed run task",
      "Completed",
    );
    await seedRun(oldCompletedTask.id, "Completed", {
      runtimeRunRef: "run-too-old-completed",
      endedAt: minutesFromNow(-25 * 60),
      updatedAt: minutesFromNow(-25 * 60),
    });

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
    const byTask = (taskId: string) =>
      items.filter((item) => item.sourceTaskId === taskId);

    expect(byTask(overdueTask.id).map((item) => item.kind)).toEqual([
      "task_overdue",
    ]);
    expect(byTask(dueNowTask.id).map((item) => item.kind)).toEqual([
      "task_due_now",
    ]);
    expect(byTask(dueSoonTask.id).map((item) => item.kind)).toEqual([
      "task_due_soon",
    ]);
    expect(
      items.some((item) => item.sourceTaskTitle === "Old overdue task"),
    ).toBe(false);
    expect(
      items.some((item) => item.sourceTaskTitle === "Far future task"),
    ).toBe(false);
    expect(
      items.some((item) => item.sourceTaskTitle === "Closed due task"),
    ).toBe(false);

    expect(byTask(autoStartedTask.id).map((item) => item.kind)).toEqual([
      "auto_execution_started",
    ]);
    expect(byTask(autoSkippedTask.id)).toHaveLength(1);
    expect(byTask(autoSkippedTask.id)[0]).toMatchObject({
      kind: "auto_execution_skipped",
      workBlockId: "block-actionable",
      summary: "Accept a plan before automatic execution can start.",
      detail: "no_accepted_plan",
    });
    expect(items.some((item) => item.sourceTaskId === oldAutoTask.id)).toBe(
      false,
    );

    expect(byTask(completedTask.id)).toHaveLength(1);
    expect(byTask(completedTask.id)[0]).toMatchObject({
      kind: "execution_completed",
      currentRunLabel: latestCompletedRun.runtimeRunRef,
      workBlockId: completedBlock.id,
    });
    expect(
      items.some((item) => item.sourceTaskId === oldCompletedTask.id),
    ).toBe(false);
    expect(byTask(staleCompletedTask.id).map((item) => item.kind)).toEqual([
      "recovery",
    ]);

    expect(byTask(infoTask.id)[0]).toMatchObject({
      kind: "notification_info",
      actionType: "Heads up",
      riskLevel: "medium",
      summary: "Background sync finished.",
    });
  });
});

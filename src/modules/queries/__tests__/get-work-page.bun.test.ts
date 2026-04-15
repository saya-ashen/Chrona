import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ApprovalStatus,
  RunStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceStatus,
} from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getWorkPage, WorkPageTaskNotFoundError } from "@/modules/queries/get-work-page";

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

describe("getWorkPage", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("returns only pending approvals for the pending approvals panel", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work Query",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Execution surface",
        status: TaskStatus.Blocked,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    await db.approval.createMany({
      data: [
        {
          id: "approval_pending",
          workspaceId: workspace.id,
          taskId: task.id,
          runId: run.id,
          type: "exec_command",
          title: "Pending approval",
          status: ApprovalStatus.Pending,
          summary: "Needs a decision",
          riskLevel: "high",
          requestedAt: new Date("2026-04-08T10:00:00.000Z"),
        },
        {
          id: "approval_resolved",
          workspaceId: workspace.id,
          taskId: task.id,
          runId: run.id,
          type: "exec_command",
          title: "Resolved approval",
          status: ApprovalStatus.Approved,
          summary: "Already resolved",
          riskLevel: "high",
          requestedAt: new Date("2026-04-08T10:01:00.000Z"),
          resolvedAt: new Date(),
        },
      ],
    });

    await db.conversationEntry.create({
      data: {
        runId: run.id,
        role: "assistant",
        content: "I need approval before editing files.",
        sequence: 1,
      },
    });

    await db.event.create({
      data: {
        taskId: task.id,
        workspaceId: workspace.id,
        eventType: "approval.requested",
        actorType: "runtime",
        actorId: "openclaw",
        source: "runtime",
        dedupeKey: `approval.requested:${task.id}`,
        payload: { command: "edit files", scope: "repo" },
        ingestSequence: 1,
      },
    });

    const page = await getWorkPage(task.id);

    expect(page.currentIntervention).toMatchObject({
      kind: "approval",
      title: "Resolve approval",
      whyNow: "A human decision is required before the next execution step can proceed.",
    });
    expect(page.inspector.approvals).toHaveLength(1);
    expect(page.inspector.approvals[0]).toMatchObject({
      id: "approval_pending",
      status: "Pending",
    });
    expect(page.currentIntervention?.approvals).toHaveLength(1);
    expect(page.currentIntervention?.evidence.length).toBeGreaterThan(0);
    expect(page.latestOutput).toMatchObject({
      kind: "message",
      sourceLabel: "Conversation output",
    });
    expect(page.reliability).toMatchObject({
      syncStatus: expect.any(String),
      isStale: false,
      stopReason: "Waiting for approval decision",
    });
    expect(page.closure).toMatchObject({
      canAcceptResult: false,
      canMarkDone: false,
      canCreateFollowUp: false,
    });
    expect(page.workstreamItems[0]).toMatchObject({
      kind: "approval",
      badge: "Needs approval",
      linkedEvidenceLabel: "Linked to Next Action",
    });
    expect(
      page.workspaceRail?.sections.flatMap((section) => section.items).find((item) => item.isCurrent),
    ).toMatchObject({
      taskId: task.id,
      title: "Execution surface",
      isCurrent: true,
    });
    expect(page.taskPlan).toMatchObject({
      state: "empty",
      currentStepId: null,
    });
  });

  it("derives a ready task plan from the latest plan event and live run state", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work Plan",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Prepare task plan",
        status: TaskStatus.Blocked,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    await db.event.create({
      data: {
        taskId: task.id,
        workspaceId: workspace.id,
        eventType: "task.plan_generated",
        actorType: "agent",
        actorId: "work-plan-agent",
        source: "planner",
        dedupeKey: `task.plan_generated:${task.id}`,
        payload: {
          revision: "generated",
          generated_by: "work-plan-agent",
          is_mock: true,
          summary: "先澄清目标与背景，再推进首轮产出。",
          change_summary: "已生成初始占位计划。",
          steps: [
            { id: "understand-task", title: "梳理目标与约束", objective: "确认目标。", phase: "理解" },
            { id: "gather-context", title: "补齐上下文", objective: "整理背景。", phase: "准备" },
            { id: "execute-task", title: "推进首轮产出", objective: "推进当前执行。", phase: "执行" },
            { id: "confirm-next-step", title: "确认结果与下一步", objective: "等待结果后确认后续动作。", phase: "确认" },
          ],
        },
        ingestSequence: 1,
      },
    });

    const page = await getWorkPage(task.id);

    expect(page.taskPlan).toMatchObject({
      state: "ready",
      revision: "generated",
      generatedBy: "work-plan-agent",
      isMock: true,
      summary: "先澄清目标与背景，再推进首轮产出。",
      changeSummary: "已生成初始占位计划。",
      currentStepId: "execute-task",
    });
    expect(page.taskPlan.steps).toEqual([
      expect.objectContaining({ id: "understand-task", status: "done", needsUserInput: false }),
      expect.objectContaining({ id: "gather-context", status: "done", needsUserInput: false }),
      expect.objectContaining({ id: "execute-task", status: "waiting_for_user", needsUserInput: true }),
      expect.objectContaining({ id: "confirm-next-step", status: "pending", needsUserInput: false }),
    ]);
  });

  it("includes conversation history from earlier runs in the collaboration feed", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work History",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Show full conversation history",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const olderRun = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.Completed,
        triggeredBy: "user",
        createdAt: new Date("2026-04-19T09:00:00.000Z"),
      },
    });
    const latestRun = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.Running,
        triggeredBy: "user",
        createdAt: new Date("2026-04-20T09:00:00.000Z"),
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: latestRun.id },
    });

    await db.conversationEntry.createMany({
      data: [
        {
          runId: olderRun.id,
          role: "assistant",
          content: "这是更早一轮的任务理解。",
          sequence: 1,
          runtimeTs: new Date("2026-04-19T09:01:00.000Z"),
        },
        {
          runId: olderRun.id,
          role: "user",
          content: "先别改 schedule，只看 work 页面。",
          sequence: 2,
          runtimeTs: new Date("2026-04-19T09:02:00.000Z"),
        },
        {
          runId: latestRun.id,
          role: "assistant",
          content: "这是最新一轮的继续推进。",
          sequence: 1,
          runtimeTs: new Date("2026-04-20T09:01:00.000Z"),
        },
      ],
    });

    const page = await getWorkPage(task.id);

    expect(page.currentRun?.id).toBe(latestRun.id);
    expect(page.conversation.map((entry) => entry.content)).toEqual([
      "这是更早一轮的任务理解。",
      "先别改 schedule，只看 work 页面。",
      "这是最新一轮的继续推进。",
    ]);
  });

  it("returns reliability and closure metadata for completed runs", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work Closure",
        defaultRuntime: "openclaw",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Close the loop",
        status: TaskStatus.Completed,
        priority: TaskPriority.High,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        status: RunStatus.Completed,
        triggeredBy: "user",
        startedAt: new Date("2026-04-08T10:00:00.000Z"),
        endedAt: new Date("2026-04-08T10:30:00.000Z"),
        lastSyncedAt: new Date("2026-04-08T10:31:00.000Z"),
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    await db.event.createMany({
      data: [
        {
          taskId: task.id,
          workspaceId: workspace.id,
          runId: run.id,
          eventType: "run.completed",
          actorType: "runtime",
          actorId: "openclaw",
          source: "runtime",
          dedupeKey: `run.completed:${run.id}`,
          payload: { outcome: "success" },
          ingestSequence: 1,
        },
        {
          taskId: task.id,
          workspaceId: workspace.id,
          runId: run.id,
          eventType: "task.result_accepted",
          actorType: "user",
          actorId: "server-action",
          source: "ui",
          dedupeKey: `task.result_accepted:${task.id}:${run.id}`,
          payload: { accepted: true },
          ingestSequence: 2,
        },
      ],
    });

    const followUp = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: task.id,
        title: "Follow up the loop",
        status: TaskStatus.Draft,
        priority: TaskPriority.Medium,
        ownerType: "human",
        scheduleStatus: "Unscheduled",
      },
    });

    const page = await getWorkPage(task.id);

    expect(page.currentIntervention).toMatchObject({
      kind: "review",
    });
    expect(page.reliability).toMatchObject({
      isStale: false,
      stopReason: "Run finished and is ready for review",
    });
    expect(page.closure).toMatchObject({
      resultAccepted: true,
      canAcceptResult: false,
      canMarkDone: true,
      canCreateFollowUp: true,
      canRetry: true,
      canReopen: false,
      latestFollowUp: {
        id: followUp.id,
        title: "Follow up the loop",
        status: "Draft",
        scheduleStatus: "Unscheduled",
      },
    });
  });

  it("throws a dedicated not-found error for missing tasks", async () => {
    await expect(getWorkPage("task_missing")).rejects.toBeInstanceOf(WorkPageTaskNotFoundError);
  });
});

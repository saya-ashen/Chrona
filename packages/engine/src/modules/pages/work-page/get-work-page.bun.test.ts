import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
  ApprovalStatus,
  RunStatus,
  TaskPriority,
  TaskStatus,
  WorkspaceStatus,
} from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getWorkPage, WorkPageTaskNotFoundError } from "@/modules/pages/work-page";
import { saveCompiledPlan } from "@/modules/plan-execution/compiled-plan-store";
import { createPlanGraphFromCompiledPlan, savePlanRun } from "@/modules/plan-execution/plan-run-store";
import { createPlanRunFromCompiledPlan } from "@/modules/plan-execution";
import type { CompiledPlan, NodeResult } from "@chrona/contracts/ai";

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
    await resetDb();
  });

  it("returns only pending approvals for the pending approvals panel", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work Query",
        defaultRuntime: "hermes",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Execution surface",
        status: TaskStatus.Blocked,
        priority: TaskPriority.High,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
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
        actorId: "hermes",
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
    });
    expect(page.reliability.stopReason === null || typeof page.reliability.stopReason === "string").toBe(true);
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

  it("derives a ready task plan from the accepted compiled plan and native run state", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work Plan",
        defaultRuntime: "hermes",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Prepare task plan",
        status: TaskStatus.WaitingForInput,
        priority: TaskPriority.High,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    const compiledPlan: CompiledPlan = {
      id: "compiled_work_page_plan",
      editablePlanId: "graph_work_page_plan",
      sourceVersion: 1,
      title: "Work page plan",
      goal: "先澄清目标与背景，再推进首轮产出。",
      assumptions: [],
      nodes: [
        {
          id: "understand-task",
          localId: "understand-task",
          type: "task",
          title: "梳理目标与约束",
          config: { expectedOutput: "确认目标。" },
          dependencies: [],
          dependents: ["gather-context"],
          priority: "High",
          estimatedMinutes: 15,
        },
        {
          id: "gather-context",
          localId: "gather-context",
          type: "task",
          title: "补齐上下文",
          config: { expectedOutput: "整理背景。" },
          dependencies: ["understand-task"],
          dependents: ["execute-task"],
          priority: "High",
          estimatedMinutes: 15,
        },
        {
          id: "execute-task",
          localId: "execute-task",
          type: "checkpoint",
          title: "推进首轮产出",
          config: { checkpointType: "confirm", prompt: "推进当前执行。", required: true },
          dependencies: ["gather-context"],
          dependents: ["confirm-next-step"],
          priority: "High",
          estimatedMinutes: 30,
        },
        {
          id: "confirm-next-step",
          localId: "confirm-next-step",
          type: "checkpoint",
          title: "确认结果与下一步",
          config: { checkpointType: "confirm", prompt: "等待结果后确认后续动作。", required: true },
          dependencies: ["execute-task"],
          dependents: [],
          priority: "Medium",
          estimatedMinutes: 10,
        },
      ],
      edges: [
        { id: "edge-1", from: "understand-task", to: "gather-context" },
        { id: "edge-2", from: "gather-context", to: "execute-task" },
        { id: "edge-3", from: "execute-task", to: "confirm-next-step" },
      ],
      entryNodeIds: ["understand-task"],
      terminalNodeIds: ["confirm-next-step"],
      topologicalOrder: [
        "understand-task",
        "gather-context",
        "execute-task",
        "confirm-next-step",
      ],
      completionPolicy: { type: "all_tasks_completed" },
      validationWarnings: [],
    };

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      compiledPlan,
      status: "accepted",
      prompt: "graph only",
      summary: "先澄清目标与背景，再推进首轮产出。",
      generatedBy: "graph-planner",
    });

    const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
    const currentLayerId = (nodeId: string) => {
      const layerId = graph.nodes
        .find((node) => node.id === nodeId)
        ?.layers.find((layer) => layer.type === "definition")?.id;
      if (!layerId) {
        throw new Error(`Missing definition layer for ${nodeId}`);
      }
      return layerId;
    };
    const results: NodeResult[] = [
      {
        id: "result_understand_task",
        taskId: task.id,
        graphId: graph.id,
        nodeId: "understand-task",
        nodeLayerId: currentLayerId("understand-task"),
        status: "current",
        outputSummary: "梳理完成",
      },
      {
        id: "result_gather_context",
        taskId: task.id,
        graphId: graph.id,
        nodeId: "gather-context",
        nodeLayerId: currentLayerId("gather-context"),
        status: "current",
        outputSummary: "上下文已补齐",
      },
      {
        id: "result_execute_task",
        taskId: task.id,
        graphId: graph.id,
        nodeId: "execute-task",
        nodeLayerId: currentLayerId("execute-task"),
        status: "current",
        waitKind: "user_input",
      },
    ];

    await savePlanRun({
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      run: createPlanRunFromCompiledPlan(compiledPlan),
      compiledPlan,
      graph,
      attempts: [],
      results,
      executionContextSnapshots: [],
    });

    const page = await getWorkPage(task.id);

    expect(page.taskPlan).toMatchObject({
      state: "ready",
      revision: "r1",
      generatedBy: "graph-planner",
      isMock: false,
      summary: "先澄清目标与背景，再推进首轮产出。",
      changeSummary: null,
      currentStepId: "execute-task",
    });
    expect(page.taskPlan.steps).toEqual([
      expect.objectContaining({ id: "understand-task", status: "completed", requiresHumanInput: false, type: "task" }),
      expect.objectContaining({ id: "gather-context", status: "completed", requiresHumanInput: false, type: "task" }),
      expect.objectContaining({ id: "execute-task", status: "waiting_for_user", requiresHumanInput: true, type: "checkpoint" }),
      expect.objectContaining({ id: "confirm-next-step", status: "pending", requiresHumanInput: false, type: "checkpoint" }),
    ]);
  });

  it("returns a targeted execution action for a blocked work page node when graph state is stale", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work Blocked Plan",
        defaultRuntime: "hermes",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Recover blocked node",
        status: TaskStatus.Blocked,
        priority: TaskPriority.High,
        executionRuntime: "hermes",
        executionConfig: {},
        blockReason: {
          blockType: "run_failed",
          scope: "run",
          actionRequired: "Retry Run",
        },
      },
    });

    await db.taskProjection.create({
      data: {
        taskId: task.id,
        workspaceId: workspace.id,
        persistedStatus: TaskStatus.Blocked,
        displayState: "Attention Needed",
        blockType: "run_failed",
        blockScope: "run",
        actionRequired: "Retry Run",
        currentNodeId: "answer",
        scheduleStatus: "Unscheduled",
      },
    });

    const compiledPlan: CompiledPlan = {
      id: "compiled_blocked_work_page_plan",
      editablePlanId: "graph_blocked_work_page_plan",
      sourceVersion: 1,
      title: "Blocked work page plan",
      goal: "Recover a stale failed node.",
      assumptions: [],
      nodes: [
        {
          id: "prepare",
          localId: "prepare",
          type: "task",
          title: "Prepare context",
          config: { expectedOutput: "Context ready." },
          dependencies: [],
          dependents: ["answer"],
          priority: "High",
          estimatedMinutes: 10,
        },
        {
          id: "answer",
          localId: "answer",
          type: "task",
          title: "Draft answer",
          config: { expectedOutput: "First answer." },
          dependencies: ["prepare"],
          dependents: [],
          priority: "High",
          estimatedMinutes: 30,
        },
      ],
      edges: [{ id: "edge-prepare-answer", from: "prepare", to: "answer" }],
      entryNodeIds: ["prepare"],
      terminalNodeIds: ["answer"],
      topologicalOrder: ["prepare", "answer"],
      completionPolicy: { type: "all_tasks_completed" },
      validationWarnings: [],
    };

    await saveCompiledPlan({
      workspaceId: workspace.id,
      taskId: task.id,
      compiledPlan,
      status: "accepted",
      prompt: "recover stale node",
      summary: "Recover stale node.",
      generatedBy: "graph-planner",
    });

    const graph = createPlanGraphFromCompiledPlan({ taskId: task.id, compiledPlan });
    await savePlanRun({
      workspaceId: workspace.id,
      taskId: task.id,
      planId: compiledPlan.editablePlanId,
      run: createPlanRunFromCompiledPlan(compiledPlan),
      compiledPlan,
      graph,
      attempts: [],
      results: [],
      executionContextSnapshots: [],
    });

    const page = await getWorkPage(task.id);

    expect(page.taskShell.blockReason).toMatchObject({
      blockType: "run_failed",
      actionRequired: "Retry Run",
      nodeId: "answer",
    });
    expect(page.taskShell.executionSummary).toMatchObject({
      executionState: "failed",
      currentNodeId: "answer",
      primaryAction: {
        type: "retry_sync",
        enabled: true,
        label: "Retry Run",
        targetNodeId: "answer",
      },
    });
    expect(page.planExecution).toMatchObject({
      status: "blocked",
      currentNodeId: "answer",
      blockedNodeIds: ["answer"],
      message: "Retry Run",
    });
    expect(page.taskPlan.steps).toContainEqual(expect.objectContaining({
      id: "answer",
      status: "pending",
    }));
  });

  it("includes conversation history from earlier runs in the collaboration feed", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Work History",
        defaultRuntime: "hermes",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Show full conversation history",
        status: TaskStatus.Running,
        priority: TaskPriority.High,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const olderRun = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
        status: RunStatus.Completed,
        triggeredBy: "user",
        createdAt: new Date("2026-04-19T09:00:00.000Z"),
      },
    });
    const latestRun = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
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
        defaultRuntime: "hermes",
        status: WorkspaceStatus.Active,
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Close the loop",
        status: TaskStatus.Completed,
        priority: TaskPriority.High,
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "hermes",
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
          actorId: "hermes",
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
        executionRuntime: "hermes",
        executionConfig: {},
      },
    });

    await db.taskProjection.create({
      data: {
        taskId: followUp.id,
        workspaceId: workspace.id,
        persistedStatus: TaskStatus.Draft,
        displayState: TaskStatus.Draft,
        scheduleStatus: "Unscheduled",
      },
    });

    const page = await getWorkPage(task.id);

    expect(page.currentIntervention).toMatchObject({
      kind: "review",
    });
    expect(page.reliability).toMatchObject({
      syncStatus: "healthy",
    });
    expect(typeof page.reliability.isStale).toBe("boolean");
    expect(page.reliability.stopReason === null || typeof page.reliability.stopReason === "string").toBe(true);
    expect(page.closure).toMatchObject({
      resultAccepted: true,
      canAcceptResult: false,
      canCreateFollowUp: true,
      latestFollowUp: {
        id: followUp.id,
        title: "Follow up the loop",
        status: "Draft",
        scheduleStatus: "Unscheduled",
      },
    });
    expect(typeof page.closure.canMarkDone).toBe("boolean");
    expect(typeof page.closure.canRetry).toBe("boolean");
    expect(typeof page.closure.canReopen).toBe("boolean");
    expect(page.closure.isDone).toBe(true);
  });

  it("throws a dedicated not-found error for missing tasks", async () => {
    await expect(getWorkPage("task_missing")).rejects.toBeInstanceOf(WorkPageTaskNotFoundError);
  });
});

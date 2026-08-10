import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { deleteTask, getTaskDeleteImpact } from "./delete-task";

async function resetDb() {
  await db.schedulerEvent.deleteMany();
  await db.reconciliationEvent.deleteMany();
  await db.graphMutationRecord.deleteMany();
  await db.graphVersion.deleteMany();
  await db.executionSession.deleteMany();
  await db.workBlock.deleteMany();
  await db.taskPlanLayer.deleteMany();
  await db.taskPlanRun.deleteMany();
  await db.taskPlan.deleteMany();
  await db.scheduleProposal.deleteMany();
  await db.toolInvocation.deleteMany();
  await db.conversationEntry.deleteMany();
  await db.runtimeCursor.deleteMany();
  await db.taskTimelineItem.deleteMany();
  await db.event.deleteMany();
  await db.rawEventLog.deleteMany();
  await db.approval.deleteMany();
  await db.goalInboxCandidate.deleteMany();
  await db.goalAssetDraft.deleteMany();
  await db.goalAssetVersion.deleteMany();
  await db.goalAsset.deleteMany();
  await db.artifact.deleteMany();
  await db.taskProjection.deleteMany();
  await db.run.deleteMany();
  await db.taskSession.deleteMany();
  await db.taskDependency.deleteMany();
  await db.memory.deleteMany();
  await db.taskAssistantMessage.deleteMany();
  await db.task.deleteMany();
  await db.goal.deleteMany();
  await db.workspace.deleteMany();
}

afterAll(async () => {
  await resetDb();
  await db.$disconnect();
});

describe("deleteTask", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("deletes execution and orchestration records for the task tree", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Delete Task", status: "Active", defaultRuntime: "hermes" },
    });
    const parent = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Parent",
        executionRuntime: "hermes",
        executionConfig: {},
        status: "Running",
        priority: "Medium",
      },
    });
    const child = await db.task.create({
      data: {
        workspaceId: workspace.id,
        parentTaskId: parent.id,
        title: "Child",
        executionRuntime: "hermes",
        executionConfig: {},
        status: "Running",
        priority: "Medium",
      },
    });
    const run = await db.run.create({
      data: {
        taskId: child.id,
        runtimeName: "hermes",
        runtimeRunRef: "run_child",
        status: "Running",
        triggeredBy: "user",
      },
    });
    await db.runtimeCursor.create({
      data: { runId: run.id, runtimeName: "hermes" },
    });
    await db.conversationEntry.create({
      data: { runId: run.id, role: "assistant", content: "hello", sequence: 1 },
    });
    await db.toolInvocation.create({
      data: { workspaceId: workspace.id, taskId: child.id, runId: run.id, toolName: "shell", status: "completed" },
    });
    await db.workBlock.create({
      data: {
        workspaceId: workspace.id,
        taskId: child.id,
        title: "Child block",
        status: "Active",
        scheduledStartAt: new Date("2026-05-22T10:00:00.000Z"),
        scheduledEndAt: new Date("2026-05-22T11:00:00.000Z"),
      },
    });
    await db.executionSession.create({
      data: { workspaceId: workspace.id, taskId: child.id, status: "Active", planId: "plan_child" },
    });
    await db.schedulerEvent.create({
      data: { workspaceId: workspace.id, taskId: child.id, eventType: "scheduler.repair" },
    });

    await deleteTask(parent.id, { expectedTaskIds: [parent.id, child.id], expectedAssetIds: [] });

    expect(await db.task.count()).toBe(0);
    expect(await db.run.count()).toBe(0);
    expect(await db.runtimeCursor.count()).toBe(0);
    expect(await db.conversationEntry.count()).toBe(0);
    expect(await db.toolInvocation.count()).toBe(0);
    expect(await db.workBlock.count()).toBe(0);
    expect(await db.executionSession.count()).toBe(0);
    expect(await db.schedulerEvent.count()).toBe(0);
  });

  it("deletes plan-linked runs that have durable artifacts", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Delete plan-linked run", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Plan-linked task",
        executionRuntime: "hermes",
        executionConfig: {},
        status: "Completed",
        priority: "Medium",
      },
    });
    const plan = await db.taskPlan.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: "delete-plan-linked-run",
        revision: 1,
        status: "Accepted",
        compiledPlan: {},
      },
    });
    const planRun = await db.taskPlanRun.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: plan.planId,
        planRun: {},
      },
    });
    const attempt = await db.taskPlanNodeAttempt.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        planId: plan.planId,
        planRunId: planRun.id,
        nodeId: "node-1",
        nodeLayerId: "layer-1",
        idempotencyKey: "delete-plan-linked-attempt",
        attemptNumber: 1,
        status: "completed",
        executionEpoch: 0,
      },
    });
    const run = await db.run.create({
      data: {
        taskId: task.id,
        nodeAttemptId: attempt.id,
        runtimeName: "hermes",
        status: "Completed",
        triggeredBy: "user",
      },
    });
    await db.artifact.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "report",
        title: "Durable result",
        uri: "generated://durable-result.md",
      },
    });

    await deleteTask(task.id, { expectedTaskIds: [task.id], expectedAssetIds: [] });

    expect(await db.task.count()).toBe(0);
    expect(await db.taskPlanRun.count()).toBe(0);
    expect(await db.taskPlanNodeAttempt.count()).toBe(0);
    expect(await db.run.count()).toBe(0);
    expect(await db.artifact.count()).toBe(0);
  });

  it("previews and deletes Goal assets produced by the task tree", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Delete assets", status: "Active", defaultRuntime: "hermes" },
    });
    const goal = await db.goal.create({
      data: { workspaceId: workspace.id, title: "Goal", status: "Active", successCriteria: [] },
    });
    const parent = await db.task.create({
      data: { workspaceId: workspace.id, goalId: goal.id, title: "Parent", executionRuntime: "hermes", executionConfig: {}, status: "Completed", priority: "Medium" },
    });
    const child = await db.task.create({
      data: { workspaceId: workspace.id, goalId: goal.id, parentTaskId: parent.id, title: "Child", executionRuntime: "hermes", executionConfig: {}, status: "Completed", priority: "Medium" },
    });
    const run = await db.run.create({
      data: { taskId: child.id, runtimeName: "hermes", status: "Completed", triggeredBy: "user" },
    });
    const artifact = await db.artifact.create({
      data: { workspaceId: workspace.id, taskId: child.id, runId: run.id, type: "report", title: "Result", uri: "generated://result.md" },
    });
    const asset = await db.goalAsset.create({
      data: { workspaceId: workspace.id, goalId: goal.id, sourceArtifactId: artifact.id, currentArtifactId: artifact.id, kind: "document", role: "working_document", status: "Approved", label: "Durable result" },
    });
    const version = await db.goalAssetVersion.create({
      data: { workspaceId: workspace.id, goalId: goal.id, assetId: asset.id, artifactId: artifact.id, version: 1, source: "inbox", content: "Formal", contentHash: "formal", authorType: "user" },
    });
    await db.goalAssetDraft.create({
      data: { workspaceId: workspace.id, goalId: goal.id, assetId: asset.id, baseVersionId: version.id, content: "Draft", contentHash: "draft", authorType: "user" },
    });

    const impact = await getTaskDeleteImpact(parent.id);
    expect(impact).toEqual({
      taskIds: expect.arrayContaining([parent.id, child.id]),
      taskCount: 2,
      assets: [{ id: asset.id, label: "Durable result", goalId: goal.id }],
    });

    await deleteTask(parent.id, {
      expectedTaskIds: impact.taskIds,
      expectedAssetIds: impact.assets.map((item) => item.id),
    });

    expect(await db.task.count()).toBe(0);
    expect(await db.artifact.count()).toBe(0);
    expect(await db.goalAsset.count()).toBe(0);
    expect(await db.goalAssetVersion.count()).toBe(0);
    expect(await db.goalAssetDraft.count()).toBe(0);
    expect(await db.goal.count()).toBe(1);
  });

  it("rejects deletion when the confirmed impact is stale", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Stale delete", status: "Active", defaultRuntime: "hermes" },
    });
    const task = await db.task.create({
      data: { workspaceId: workspace.id, title: "Task", executionRuntime: "hermes", executionConfig: {}, status: "Ready", priority: "Medium" },
    });

    await expect(deleteTask(task.id, { expectedTaskIds: [task.id], expectedAssetIds: ["missing-asset"] }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });
});

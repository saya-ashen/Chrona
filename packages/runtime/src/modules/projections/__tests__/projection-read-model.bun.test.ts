import {
  ArtifactType,
  ApprovalStatus,
  RunStatus,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import { getWorkProjection } from "@/modules/projections/get-work-projection";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";

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

describe("projection read models", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("dedupes canonical events, rebuilds a blocked projection, and returns the work projection", async () => {
    const workspace = await db.workspace.create({
      data: {
        name: "Projection Workspace",
        defaultRuntime: "openclaw",
        status: "Active",
      },
    });

    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Review adapter mapping",
        status: TaskStatus.Running,
        priority: TaskPriority.Urgent,
        ownerType: "human",
      },
    });

    const run = await db.run.create({
      data: {
        taskId: task.id,
        runtimeName: "openclaw",
        runtimeRunRef: "runtime_projection_1",
        runtimeSessionRef: "session_projection_1",
        status: RunStatus.WaitingForApproval,
        triggeredBy: "user",
        startedAt: new Date("2026-04-08T10:00:00Z"),
        lastSyncedAt: new Date(),
      },
    });

    await db.task.update({
      where: { id: task.id },
      data: { latestRunId: run.id },
    });

    const approval = await db.approval.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: "file_change",
        title: "Approve adapter patch",
        summary: "Apply OpenClaw mapping changes",
        riskLevel: "high",
        status: ApprovalStatus.Pending,
        requestedAt: new Date("2026-04-08T10:06:00Z"),
      },
    });

    await db.artifact.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        runId: run.id,
        type: ArtifactType.patch,
        title: "projection.diff",
        uri: "file:///tmp/projection.diff",
      },
    });

    await appendCanonicalEvent({
      eventType: "run.started",
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      actorType: "user",
      actorId: "projection-test",
      source: "ui",
      payload: {
        runtime_name: "openclaw",
        runtime_run_ref: run.runtimeRunRef,
        triggered_by: "user",
      },
      dedupeKey: `run.started:${run.id}`,
      runtimeTs: new Date("2026-04-08T10:00:00Z"),
    });

    await appendCanonicalEvent({
      eventType: "run.started",
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      actorType: "user",
      actorId: "projection-test",
      source: "ui",
      payload: {
        runtime_name: "openclaw",
        runtime_run_ref: run.runtimeRunRef,
        triggered_by: "user",
      },
      dedupeKey: `run.started:${run.id}`,
      runtimeTs: new Date("2026-04-08T10:00:00Z"),
    });

    await appendCanonicalEvent({
      eventType: "approval.requested",
      workspaceId: workspace.id,
      taskId: task.id,
      runId: run.id,
      actorType: "runtime",
      actorId: "openclaw",
      source: "adapter",
      payload: {
        approval_id: approval.id,
        approval_type: approval.type,
        title: approval.title,
        summary: approval.summary,
        risk_level: approval.riskLevel,
      },
      dedupeKey: `approval.requested:${approval.id}`,
      runtimeTs: approval.requestedAt,
    });

    const appended = await db.event.findMany({
      where: { taskId: task.id },
      orderBy: { ingestSequence: "asc" },
    });

    expect(appended).toHaveLength(2);
    expect(appended[0]?.ingestSequence).toBe(1);
    expect(appended[1]?.ingestSequence).toBe(2);

    await rebuildTaskProjection(task.id);

    const storedTask = await db.task.findUnique({
      where: { id: task.id },
      include: { projection: true },
    });

    const blockReason = storedTask?.blockReason as
      | { blockType?: string; scope?: string; actionRequired?: string }
      | null
      | undefined;

    expect(storedTask?.status).toBe(TaskStatus.Blocked);
    expect(blockReason?.blockType).toBe("waiting_for_approval");
    expect(storedTask?.projection?.displayState).toBe("WaitingForApproval");
    expect(storedTask?.projection?.approvalPendingCount).toBe(1);
    expect(storedTask?.projection?.latestArtifactTitle).toBe("projection.diff");

    const workProjection = await getWorkProjection(task.id);

    expect(workProjection.taskShell.id).toBe(task.id);
    expect(workProjection.taskShell.status).toBe(TaskStatus.Blocked);
    expect(workProjection.currentRun?.id).toBe(run.id);
    expect(workProjection.timeline.map((event) => event.eventType)).toEqual([
      "run.started",
      "approval.requested",
    ]);
    expect(workProjection.approvals).toHaveLength(1);
    expect(workProjection.artifacts).toHaveLength(1);
  });
});

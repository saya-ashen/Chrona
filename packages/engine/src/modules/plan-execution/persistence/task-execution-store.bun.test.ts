import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  cancelActiveRunsForExecutionScope,
  completeActiveRunsForExecutionScope,
  syncPersistedRunState,
  syncPersistedRunStateInTransaction,
} from "./task-execution-store";
import { resetDb, seedWorkspaceAndTask } from "../plan-runner.task-executor.fixtures";
import { acquireSchedulerLease, withSchedulerWorkOwnership } from "@/modules/orchestration/scheduler-lease-repository";

async function seedOccurrenceRun(input: {
  workspaceId: string;
  taskId: string;
  key: string;
  runStatus?: RunStatus;
}) {
  const workBlock = await db.workBlock.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      title: `Occurrence ${input.key}`,
      recurrenceKey: input.key,
      status: "Active",
      scheduledStartAt: new Date("2026-06-10T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-06-10T10:00:00.000Z"),
    },
  });
  const occurrence = await db.taskOccurrence.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      workBlockId: workBlock.id,
      occurrenceKey: input.key,
      source: { kind: "test" },
      status: "Running",
      eligibleAt: new Date("2026-06-10T09:00:00.000Z"),
      startedAt: new Date("2026-06-10T09:00:00.000Z"),
    },
  });
  const session = await db.taskSession.create({
    data: {
      taskId: input.taskId,
      runtimeName: "hermes",
      sessionKey: `scope-test:${input.taskId}:${input.key}`,
      label: `Occurrence ${input.key} session`,
    },
  });
  const run = await db.run.create({
    data: {
      taskId: input.taskId,
      workBlockId: workBlock.id,
      occurrenceId: occurrence.id,
      taskSessionId: session.id,
      runtimeName: "hermes",
      status: input.runStatus ?? RunStatus.Running,
      triggeredBy: "test",
    },
  });
  return { workBlock, occurrence, session, run };
}

describe("task execution store occurrence scope", () => {
  beforeEach(resetDb);
  afterAll(resetDb);

  it("completes only active runs owned by the finalized occurrence", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Scoped completion");
    const first = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "first" });
    const second = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "second" });

    await completeActiveRunsForExecutionScope({
      taskId: task.id,
      taskSessionId: first.session.id,
      occurrenceId: first.occurrence.id,
      workBlockId: first.workBlock.id,
    });

    expect(await db.run.findUniqueOrThrow({ where: { id: first.run.id } })).toMatchObject({
      status: RunStatus.Completed,
      endedAt: expect.any(Date),
    });
    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: first.occurrence.id } })).toMatchObject({
      status: "Completed",
      completedAt: expect.any(Date),
    });
    expect(await db.run.findUniqueOrThrow({ where: { id: second.run.id } })).toMatchObject({
      status: RunStatus.Running,
      endedAt: null,
    });
    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: second.occurrence.id } })).toMatchObject({
      status: "Running",
      completedAt: null,
    });
  });

  it("cancels only active runs owned by the cancelled occurrence", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Scoped cancellation");
    const first = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "first" });
    const second = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "second" });

    await cancelActiveRunsForExecutionScope({
      taskId: task.id,
      taskSessionId: first.session.id,
      occurrenceId: first.occurrence.id,
      workBlockId: first.workBlock.id,
      reason: "cancel first occurrence",
    });

    expect(await db.run.findUniqueOrThrow({ where: { id: first.run.id } })).toMatchObject({
      status: RunStatus.Cancelled,
      errorSummary: "cancel first occurrence",
    });
    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: first.occurrence.id } })).toMatchObject({
      status: "Cancelled",
      completedAt: expect.any(Date),
    });
    expect(await db.run.findUniqueOrThrow({ where: { id: second.run.id } })).toMatchObject({
      status: RunStatus.Running,
      endedAt: null,
    });
  });

  it("updates only the persisted run's task session", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Exact session completion");
    const first = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "first" });
    const second = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "second" });
    await db.taskSession.update({
      where: { id: second.session.id },
      data: { status: "running", activeRunId: second.run.id, lastRunStatus: RunStatus.Running },
    });
    await db.run.update({
      where: { id: first.run.id },
      data: { status: RunStatus.Completed, endedAt: new Date("2026-06-10T09:20:00.000Z") },
    });

    await syncPersistedRunState({ taskId: task.id, runId: first.run.id });

    expect(await db.taskSession.findUniqueOrThrow({ where: { id: first.session.id } })).toMatchObject({
      status: "idle",
      activeRunId: null,
      lastRunStatus: RunStatus.Completed,
      capabilityScope: "plan_execution",
      allowedToolNames: JSON.stringify([
        "chrona.execution.read",
        "chrona.goal.results.read",
        "chrona.plan.read",
        "chrona.node.read",
        "chrona.node.complete",
        "chrona.node.condition_select",
        "chrona.node.block",
        "chrona.node.fail",
        "chrona.node.wait_complete",
      ]),
    });
    expect(await db.taskSession.findUniqueOrThrow({ where: { id: second.session.id } })).toMatchObject({
      status: "running",
      activeRunId: second.run.id,
      lastRunStatus: RunStatus.Running,
    });
    expect(await db.taskSession.findUniqueOrThrow({ where: { id: second.session.id } })).toMatchObject({
      capabilityScope: "unknown",
      allowedToolNames: "[]",
    });
  });

  it("does not reopen a completed occurrence when a delayed waiting callback arrives", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Monotonic occurrence state");
    const seeded = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "only" });

    await db.run.update({
      where: { id: seeded.run.id },
      data: { status: RunStatus.Completed, endedAt: new Date("2026-06-10T09:20:00.000Z") },
    });
    await syncPersistedRunState({ taskId: task.id, runId: seeded.run.id });
    const completed = await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } });

    await db.run.update({
      where: { id: seeded.run.id },
      data: { status: RunStatus.WaitingForInput, endedAt: null },
    });
    await syncPersistedRunState({ taskId: task.id, runId: seeded.run.id });

    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } })).toMatchObject({
      status: "Completed",
      completedAt: completed.completedAt,
    });
  });

  it("does not reopen a cancelled occurrence when a delayed running callback arrives", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Cancelled occurrence monotonic state");
    const seeded = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "only" });

    await db.run.update({
      where: { id: seeded.run.id },
      data: { status: RunStatus.Cancelled, endedAt: new Date("2026-06-10T09:20:00.000Z") },
    });
    await syncPersistedRunState({ taskId: task.id, runId: seeded.run.id });
    const cancelled = await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } });

    await db.run.update({
      where: { id: seeded.run.id },
      data: { status: RunStatus.Running, endedAt: null },
    });
    await syncPersistedRunState({ taskId: task.id, runId: seeded.run.id });

    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } })).toMatchObject({
      status: "Cancelled",
      completedAt: cancelled.completedAt,
    });
  });

  it("does not reopen a failed occurrence when a delayed waiting callback arrives", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Failed occurrence monotonic state");
    const seeded = await seedOccurrenceRun({ workspaceId: workspace.id, taskId: task.id, key: "only" });

    await db.run.update({
      where: { id: seeded.run.id },
      data: { status: RunStatus.Failed, endedAt: new Date("2026-06-10T09:20:00.000Z") },
    });
    await syncPersistedRunState({ taskId: task.id, runId: seeded.run.id });
    const failed = await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } });

    await db.run.update({
      where: { id: seeded.run.id },
      data: { status: RunStatus.WaitingForApproval, endedAt: null },
    });
    await syncPersistedRunState({ taskId: task.id, runId: seeded.run.id });

    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } })).toMatchObject({
      status: "Failed",
      completedAt: failed.completedAt,
    });
  });
  it("does not mutate recovery occurrence or projection state after lease takeover", async () => {
    const { workspace, task } = await seedWorkspaceAndTask("Stale recovery projection");
    const seeded = await seedOccurrenceRun({
      workspaceId: workspace.id,
      taskId: task.id,
      key: "stale-recovery",
      runStatus: RunStatus.Completed,
    });
    const first = await acquireSchedulerLease({
      name: "recovery-projection",
      ownerId: "owner-a",
      ttlMs: 30_000,
    });
    await acquireSchedulerLease({
      name: "recovery-projection",
      ownerId: "owner-b",
      ttlMs: 30_000,
      now: new Date(Date.now() + 60_000),
    });
    const controller = new AbortController();

    await expect(withSchedulerWorkOwnership({
      signal: controller.signal,
      lease: { name: first.lease.name, ownerId: first.lease.ownerId, epoch: first.lease.epoch },
      isLeaseCurrent: () => true,
    }, (tx) => syncPersistedRunStateInTransaction({ taskId: task.id, runId: seeded.run.id }, tx))).rejects.toThrow("Scheduler lease ownership was lost.");

    expect(await db.taskOccurrence.findUniqueOrThrow({ where: { id: seeded.occurrence.id } })).toMatchObject({
      status: "Running",
      completedAt: null,
    });
    expect(await db.taskProjection.findUnique({ where: { taskId: task.id } })).toBeNull();
  });
});

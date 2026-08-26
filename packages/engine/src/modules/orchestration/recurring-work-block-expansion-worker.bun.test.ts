import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { acquireSchedulerLease } from "./scheduler-lease-repository";
import { runRecurringWorkBlockExpansionWorker } from "./recurring-work-block-expansion-worker";

async function resetDb() {
  try {
    await db.$executeRaw`PRAGMA foreign_keys = OFF`;
    await db.taskOccurrence.deleteMany();
    await db.workBlock.deleteMany();
    await db.taskSession.deleteMany();
    await db.taskTrigger.deleteMany();
    await db.task.deleteMany();
    await db.workspace.deleteMany();
    await db.schedulerLease.deleteMany();
  } finally {
    await db.$executeRaw`PRAGMA foreign_keys = ON`;
  }
}

describe("runRecurringWorkBlockExpansionWorker", () => {
  beforeEach(resetDb);

  it("does not materialize recurring domain writes after ownership becomes stale mid-expansion", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Recurring expansion", status: "Active" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Daily task",
        status: "Ready",
        priority: "High",
        executionConfig: { prompt: "Run" },
      },
    });
    await db.taskTrigger.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        kind: "schedule",
        state: "Enabled",
        config: {
          mode: "recurring",
          rrule: "FREQ=DAILY",
          anchorStartAt: "2026-05-17T09:00:00.000Z",
          timezone: "UTC",
          durationMs: 3_600_000,
        },
      },
    });
    const lease = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "owner-a",
      ttlMs: 60_000,
    });
    let ownershipChecks = 0;

    await expect(runRecurringWorkBlockExpansionWorker({
      now: new Date("2026-05-17T08:00:00.000Z"),
      workContext: {
        signal: new AbortController().signal,
        lease: {
          name: lease.lease.name,
          ownerId: lease.lease.ownerId,
          epoch: lease.lease.epoch,
        },
        isLeaseCurrent: () => ++ownershipChecks < 7,
      },
    })).rejects.toThrow("Scheduler lease ownership was lost.");

    expect(await db.taskTrigger.count({ where: { taskId: task.id } })).toBe(1);
    expect(await db.workBlock.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.taskOccurrence.count({ where: { taskId: task.id } })).toBe(0);
    expect(await db.taskSession.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("materializes a new work block for the same recurrence after a trigger version changes", async () => {
    const workspace = await db.workspace.create({
      data: { name: "Versioned recurring expansion", status: "Active" },
    });
    const task = await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: "Versioned daily task",
        status: "Ready",
        priority: "High",
        executionConfig: { prompt: "Run" },
      },
    });
    const trigger = await db.taskTrigger.create({
      data: {
        workspaceId: workspace.id,
        taskId: task.id,
        kind: "schedule",
        state: "Enabled",
        config: {
          mode: "recurring",
          rrule: "FREQ=DAILY",
          anchorStartAt: "2026-05-17T09:00:00.000Z",
          timezone: "UTC",
          durationMs: 3_600_000,
        },
      },
    });
    const now = new Date("2026-05-17T08:00:00.000Z");

    await runRecurringWorkBlockExpansionWorker({ now });
    const first = await db.taskOccurrence.findFirstOrThrow({
      where: { taskId: task.id, triggerVersion: 1 },
      orderBy: { eligibleAt: "asc" },
    });
    await db.taskOccurrence.update({ where: { id: first.id }, data: { status: "Cancelled", completedAt: now } });
    await db.workBlock.update({ where: { id: first.workBlockId! }, data: { status: "Cancelled", completedAt: now } });
    await db.taskTrigger.update({ where: { id: trigger.id }, data: { version: 2 } });

    await runRecurringWorkBlockExpansionWorker({ now });
    const second = await db.taskOccurrence.findFirstOrThrow({
      where: { taskId: task.id, triggerVersion: 2, eligibleAt: first.eligibleAt },
      include: { workBlock: true },
    });
    expect(second.occurrenceKey).toBe(`schedule:v2:${first.eligibleAt.toISOString()}`);
    expect(second.workBlockId).not.toBe(first.workBlockId);
    expect(second.workBlock?.recurrenceKey).toBe(second.occurrenceKey);
  });
});

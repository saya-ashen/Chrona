import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import {
  acquireSchedulerLease,
  completeSchedulerLeaseWork,
  releaseSchedulerLease,
  renewSchedulerLease,
} from "@/modules/orchestration/scheduler-lease-repository";

async function resetDb() {
  await db.schedulerLease.deleteMany();
}

describe("scheduler lease repository", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await db.$disconnect();
  });

  it("acquires a new lease", async () => {
    const now = new Date("2026-05-17T10:00:00.000Z");

    const result = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      ttlMs: 30_000,
      now,
      metadata: { region: "local" },
    });

    expect(result.acquired).toBe(true);
    expect(result.lease).toMatchObject({
      name: "task-orchestrator",
      ownerId: "worker-a",
      epoch: 1,
      heartbeatAt: now,
      expiresAt: new Date("2026-05-17T10:00:30.000Z"),
      metadata: { region: "local" },
    });
  });

  it("rejects a competing owner while the lease is active", async () => {
    const now = new Date("2026-05-17T10:00:00.000Z");
    await acquireSchedulerLease({ name: "task-orchestrator", ownerId: "worker-a", ttlMs: 30_000, now });

    const result = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-b",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:10.000Z"),
    });

    expect(result.acquired).toBe(false);
    expect(result.lease.ownerId).toBe("worker-a");
  });

  it("recovers an expired lease for a new owner", async () => {
    await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:00.000Z"),
    });

    const result = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-b",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:31.000Z"),
    });

    expect(result.acquired).toBe(true);
    expect(result.lease.epoch).toBe(2);
    expect(result.lease.ownerId).toBe("worker-b");
    expect(result.lease.expiresAt).toEqual(new Date("2026-05-17T10:01:01.000Z"));
  });

  it("renews only the active owning lease", async () => {
    await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:00.000Z"),
    });

    const ownerLease = await db.schedulerLease.findUniqueOrThrow({ where: { name: "task-orchestrator" } }) as unknown as { epoch: number };
    const competingRenewal = await renewSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-b",
      epoch: ownerLease.epoch,
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:10.000Z"),
    });
    expect(competingRenewal.renewed).toBe(false);

    const renewal = await renewSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      epoch: ownerLease.epoch,
      ttlMs: 60_000,
      now: new Date("2026-05-17T10:00:20.000Z"),
    });

    expect(renewal.renewed).toBe(true);
    expect(renewal.lease?.expiresAt).toEqual(new Date("2026-05-17T10:01:20.000Z"));
  });

  it("releases only the current owner epoch", async () => {
    const acquired = await acquireSchedulerLease({ name: "task-orchestrator", ownerId: "worker-a", ttlMs: 30_000 });

    await expect(releaseSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-b",
      epoch: acquired.lease.epoch,
    })).resolves.toBe(false);
    expect(await db.schedulerLease.count()).toBe(1);

    await expect(releaseSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      epoch: acquired.lease.epoch,
    })).resolves.toBe(true);
    expect(await db.schedulerLease.count()).toBe(0);
  });

  it("fences an old epoch after lease takeover", async () => {
    const first = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:00.000Z"),
    });
    const second = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-b",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:31.000Z"),
    });

    expect(second.lease.epoch).toBe(first.lease.epoch + 1);
    await expect(releaseSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      epoch: first.lease.epoch,
    })).resolves.toBe(false);
  });

  it("rejects stale durable completion after lease takeover", async () => {
    const first = await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-a",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:00.000Z"),
    });
    await acquireSchedulerLease({
      name: "task-orchestrator",
      ownerId: "worker-b",
      ttlMs: 30_000,
      now: new Date("2026-05-17T10:00:31.000Z"),
    });

    await expect(completeSchedulerLeaseWork({
      name: "task-orchestrator",
      ownerId: "worker-a",
      epoch: first.lease.epoch,
      worker: "stale-worker",
      status: "completed",
      now: new Date("2026-05-17T10:00:31.000Z"),
    })).resolves.toBe(false);
  });
});

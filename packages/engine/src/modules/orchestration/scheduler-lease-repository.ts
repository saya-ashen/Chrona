import { db } from "@/lib/db";

export type SchedulerLeaseInput = {
  name: string;
  ownerId: string;
  ttlMs: number;
  now?: Date;
  metadata?: unknown;
};

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function acquireSchedulerLease(input: SchedulerLeaseInput) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);

  try {
    const lease = await db.schedulerLease.create({
      data: {
        name: input.name,
        ownerId: input.ownerId,
        heartbeatAt: now,
        expiresAt,
        metadata: input.metadata ?? undefined,
      },
    });
    return { acquired: true as const, lease };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const claimed = await db.schedulerLease.updateMany({
    where: {
      name: input.name,
      OR: [{ ownerId: input.ownerId }, { expiresAt: { lte: now } }],
    },
    data: {
      ownerId: input.ownerId,
      heartbeatAt: now,
      expiresAt,
      metadata: input.metadata ?? undefined,
    },
  });
  const lease = await db.schedulerLease.findUniqueOrThrow({ where: { name: input.name } });
  return { acquired: claimed.count === 1, lease };
}

export async function renewSchedulerLease(input: SchedulerLeaseInput) {
  const now = input.now ?? new Date();
  const renewed = await db.schedulerLease.updateMany({
    where: { name: input.name, ownerId: input.ownerId, expiresAt: { gt: now } },
    data: {
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + input.ttlMs),
      metadata: input.metadata ?? undefined,
    },
  });
  const lease = await db.schedulerLease.findUnique({ where: { name: input.name } });
  return { renewed: renewed.count === 1, lease };
}

export async function releaseSchedulerLease(name: string, ownerId: string) {
  const released = await db.schedulerLease.deleteMany({ where: { name, ownerId } });
  return released.count === 1;
}

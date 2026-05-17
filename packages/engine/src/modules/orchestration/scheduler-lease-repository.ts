import { db } from "@/lib/db";

export type SchedulerLeaseInput = {
  name: string;
  ownerId: string;
  ttlMs: number;
  now?: Date;
  metadata?: unknown;
};

export async function acquireSchedulerLease(input: SchedulerLeaseInput) {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMs);
  const current = await db.schedulerLease.findUnique({ where: { name: input.name } });

  if (current && current.expiresAt > now && current.ownerId !== input.ownerId) {
    return { acquired: false as const, lease: current };
  }

  const lease = await db.schedulerLease.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      ownerId: input.ownerId,
      heartbeatAt: now,
      expiresAt,
      metadata: input.metadata ?? undefined,
    },
    update: {
      ownerId: input.ownerId,
      heartbeatAt: now,
      expiresAt,
      metadata: input.metadata ?? undefined,
    },
  });

  return { acquired: true as const, lease };
}

export async function renewSchedulerLease(input: SchedulerLeaseInput) {
  const now = input.now ?? new Date();
  const lease = await db.schedulerLease.findUnique({ where: { name: input.name } });
  if (!lease || lease.ownerId !== input.ownerId || lease.expiresAt <= now) {
    return { renewed: false as const, lease };
  }

  const renewed = await db.schedulerLease.update({
    where: { name: input.name },
    data: {
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + input.ttlMs),
      metadata: input.metadata ?? undefined,
    },
  });

  return { renewed: true as const, lease: renewed };
}

export async function releaseSchedulerLease(name: string, ownerId: string) {
  const lease = await db.schedulerLease.findUnique({ where: { name } });
  if (!lease || lease.ownerId !== ownerId) {
    return false;
  }
  await db.schedulerLease.delete({ where: { name } });
  return true;
}

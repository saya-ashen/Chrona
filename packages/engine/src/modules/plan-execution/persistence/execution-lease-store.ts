import { db } from "@/lib/db";

export type ExecutionLeaseScope = "manual" | "system" | "runtime-sync" | "terminal-result";

export type ExecutionLease = {
  planRunId: string;
  ownerId: string;
  scope: ExecutionLeaseScope;
  epoch: number;
  leaseUntil: Date;
};

export async function acquireExecutionLease(input: {
  taskId: string;
  workBlockId?: string | null;
  planId: string;
  ownerId: string;
  scope: ExecutionLeaseScope;
  leaseMs?: number;
  now?: Date;
}): Promise<ExecutionLease | null> {
  const now = input.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (input.leaseMs ?? 30_000));
  const existing = await db.taskPlanRun.findFirst({
    where: { taskId: input.taskId, planId: input.planId, workBlockId: input.workBlockId ?? null },
    select: {
      id: true,
      executionOwnerId: true,
      executionLeaseUntil: true,
      executionEpoch: true,
    },
  });

  if (!existing) return null;
  const leaseActive =
    existing.executionOwnerId &&
    existing.executionOwnerId !== input.ownerId &&
    existing.executionLeaseUntil &&
    existing.executionLeaseUntil > now;
  if (leaseActive) return null;

  const row = await db.taskPlanRun.update({
    where: { id: existing.id },
    data: {
      executionOwnerId: input.ownerId,
      executionOwnerScope: input.scope,
      executionLeaseUntil: leaseUntil,
      executionEpoch: { increment: 1 },
    },
    select: {
      id: true,
      executionOwnerId: true,
      executionOwnerScope: true,
      executionLeaseUntil: true,
      executionEpoch: true,
    },
  });

  return {
    planRunId: row.id,
    ownerId: row.executionOwnerId ?? input.ownerId,
    scope: (row.executionOwnerScope ?? input.scope) as ExecutionLeaseScope,
    epoch: row.executionEpoch,
    leaseUntil: row.executionLeaseUntil ?? leaseUntil,
  };
}

export async function releaseExecutionLease(input: {
  planRunId: string;
  ownerId: string;
  epoch: number;
}) {
  return db.taskPlanRun.updateMany({
    where: {
      id: input.planRunId,
      executionOwnerId: input.ownerId,
      executionEpoch: input.epoch,
    },
    data: {
      executionOwnerId: null,
      executionOwnerScope: null,
      executionLeaseUntil: null,
    },
  });
}

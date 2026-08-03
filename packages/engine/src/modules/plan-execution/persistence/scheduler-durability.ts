import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { currentSchedulerWorkContext } from "@/modules/orchestration/scheduler-work-context";
import { withSchedulerWorkOwnership } from "@/modules/orchestration/scheduler-lease-repository";

/**
 * Runs a short durability mutation under the live scheduler ownership fence.
 * A caller that already owns a fenced transaction propagates it so related
 * writes can remain atomic. Non-scheduler execution uses the same short
 * transaction boundary without a lease fence.
 */
export async function withPlanExecutionDurability<T>(
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  tx?: Prisma.TransactionClient,
): Promise<T> {
  if (tx) return mutate(tx);
  const workContext = currentSchedulerWorkContext();
  if (!workContext) return db.$transaction(mutate);
  return withSchedulerWorkOwnership(workContext, mutate);
}

/** Uses the scheduler's live abort signal for provider work without creating a DB transaction. */
export function schedulerWorkSignal(signal?: AbortSignal): AbortSignal | undefined {
  const schedulerSignal = currentSchedulerWorkContext()?.signal;
  if (!schedulerSignal) return signal;
  if (!signal || signal === schedulerSignal) return schedulerSignal;
  return AbortSignal.any([signal, schedulerSignal]);
}

/** Rejects stale scheduler outcomes before work that cannot be rolled back. */
export function assertCurrentPlanExecutionOwnership() {
  const workContext = currentSchedulerWorkContext();
  if (!workContext) return;
  if (workContext.signal.aborted || !workContext.isLeaseCurrent()) {
    throw workContext.signal.reason ?? new Error("Scheduler lease ownership was lost.");
  }
}

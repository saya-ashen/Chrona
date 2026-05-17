import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { runtimeSync } from "@/modules/runtime-sync";
import { recordOrchestratorEvent } from "./scheduler-events";

const ACTIVE_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForInput,
  RunStatus.WaitingForApproval,
] as const;

type ActiveRunSyncWorkerDeps = {
  syncRun?: typeof runtimeSync.syncRun;
  recordEvent?: typeof recordOrchestratorEvent;
};

export type ActiveRunSyncWorkerResult = {
  synced: Array<{ taskId: string; runId: string }>;
  degraded: Array<{ taskId: string; runId: string; error: string }>;
};

export async function runActiveRunSyncWorker(input: {
  staleBefore?: Date;
  limit?: number;
  deps?: ActiveRunSyncWorkerDeps;
} = {}): Promise<ActiveRunSyncWorkerResult> {
  const syncRun = input.deps?.syncRun ?? runtimeSync.syncRun.bind(runtimeSync);
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  const runs = await db.run.findMany({
    where: {
      runtimeRunRef: { not: null },
      status: { in: [...ACTIVE_RUN_STATUSES] },
      ...(input.staleBefore
        ? { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: input.staleBefore } }] }
        : {}),
    },
    include: { task: { select: { workspaceId: true } } },
    orderBy: [{ lastSyncedAt: "asc" }, { createdAt: "asc" }],
    take: input.limit ?? 50,
  });

  const result: ActiveRunSyncWorkerResult = { synced: [], degraded: [] };
  for (const run of runs) {
    try {
      await syncRun({ runId: run.id });
      result.synced.push({ taskId: run.taskId, runId: run.id });
      await recordEvent({
        workspaceId: run.task.workspaceId,
        taskId: run.taskId,
        eventType: "scheduler.sync",
        payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown runtime sync error";
      await db.run.update({
        where: { id: run.id },
        data: { syncStatus: "degraded", errorSummary: message, retryable: true, lastSyncedAt: new Date() },
      });
      result.degraded.push({ taskId: run.taskId, runId: run.id, error: message });
      await recordEvent({
        workspaceId: run.task.workspaceId,
        taskId: run.taskId,
        eventType: "scheduler.fail",
        reason: message,
        payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
      });
    }
  }

  return result;
}

import { db } from "@/lib/db";
import { runtimeSync } from "@/modules/runtime-sync";
import { recordOrchestratorEvent } from "./scheduler-events";

type DegradedRetryWorkerDeps = {
  syncRun?: typeof runtimeSync.syncRun;
  recordEvent?: typeof recordOrchestratorEvent;
};

export async function runDegradedRetryWorker(input: {
  now?: Date;
  retryAfterMs?: number;
  deps?: DegradedRetryWorkerDeps;
} = {}) {
  const now = input.now ?? new Date();
  const retryAfterMs = input.retryAfterMs ?? 30_000;
  const syncRun = input.deps?.syncRun ?? runtimeSync.syncRun.bind(runtimeSync);
  const recordEvent = input.deps?.recordEvent ?? recordOrchestratorEvent;
  const staleBefore = new Date(now.getTime() - retryAfterMs);
  const runs = await db.run.findMany({
    where: {
      syncStatus: "degraded",
      retryable: true,
      runtimeRunRef: { not: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lte: staleBefore } }],
    },
    include: { task: { select: { workspaceId: true } } },
    orderBy: [{ lastSyncedAt: "asc" }, { createdAt: "asc" }],
  });

  const retried: Array<{ taskId: string; runId: string }> = [];
  for (const run of runs) {
    await syncRun({ runId: run.id });
    retried.push({ taskId: run.taskId, runId: run.id });
    await recordEvent({
      workspaceId: run.task.workspaceId,
      taskId: run.taskId,
      eventType: "scheduler.degraded_retry",
      payload: { runId: run.id, runtimeRunRef: run.runtimeRunRef },
    });
  }

  return { retried };
}

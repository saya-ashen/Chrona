import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { createRuntimeAdapter, DEFAULT_RUNTIME_ADAPTER_KEY, type RuntimeAdapter } from "@chrona/providers-core";

import { SYNC_STALE_MS } from "../../constants";

const ACTIVE_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
];

async function markSyncDegraded(run: { id: string; runtimeName: string | null }, message: string) {
  const now = new Date();
  const runtimeName = run.runtimeName ?? DEFAULT_RUNTIME_ADAPTER_KEY;

  await db.run.update({
    where: { id: run.id },
    data: {
      syncStatus: "degraded",
      mappingPartial: true,
      lastSyncedAt: now,
    },
  });

  await db.runtimeCursor.upsert({
    where: { runId: run.id },
    update: {
      runtimeName,
      lastSyncedAt: now,
      healthStatus: "degraded",
      lastError: message,
    },
    create: {
      runId: run.id,
      runtimeName,
      lastSyncedAt: now,
      healthStatus: "degraded",
      lastError: message,
    },
  });
}

async function syncRunForRead(runId: string, adapter?: RuntimeAdapter) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, runtimeName: true },
  });

  try {
    const activeAdapter = adapter ?? (await createRuntimeAdapter());
    const { syncRunFromRuntime } = await import("@/modules/runtime-sync/sync-run");
    await syncRunFromRuntime({ runId, adapter: activeAdapter });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime sync failed";
    await markSyncDegraded(run, message);
  }
}

export async function syncStaleWorkspaceRunsForRead(workspaceId: string, adapter?: RuntimeAdapter) {
  const staleBefore = new Date(Date.now() - SYNC_STALE_MS);
  const runs = await db.run.findMany({
    where: {
      task: { workspaceId },
      status: { in: ACTIVE_RUN_STATUSES },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }, { syncStatus: "degraded" }],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, runtimeName: true },
    take: 10,
  });

  if (runs.length === 0) {
    return;
  }

  let activeAdapter = adapter;

  if (!activeAdapter) {
    try {
      activeAdapter = await createRuntimeAdapter();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Runtime sync failed";

      for (const run of runs) {
        await markSyncDegraded(run, message);
      }

      return;
    }
  }

  for (const run of runs) {
    await syncRunForRead(run.id, activeAdapter);
  }
}

export async function syncTaskRunForRead(
  taskId: string,
  adapter?: RuntimeAdapter,
  options?: { forceActive?: boolean },
) {
  const run = await db.run.findFirst({
    where: {
      taskId,
      status: { in: ACTIVE_RUN_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, lastSyncedAt: true, syncStatus: true },
  });

  if (!run) {
    return;
  }

  const stale =
    options?.forceActive === true ||
    !run.lastSyncedAt ||
    run.lastSyncedAt.getTime() < Date.now() - SYNC_STALE_MS ||
    run.syncStatus === "degraded";

  if (!stale) {
    return;
  }

  await syncRunForRead(run.id, adapter);
}

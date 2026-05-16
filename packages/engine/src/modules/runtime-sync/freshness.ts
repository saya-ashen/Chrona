import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { HERMES_EXECUTION_RUNTIME } from "@chrona/hermes";
import type { OpenClawRuntimeSyncClient } from "@/modules/runtime-sync/sync-run";

import { SYNC_STALE_MS } from "../../constants";

const ACTIVE_RUN_STATUSES = [
  RunStatus.Pending,
  RunStatus.Running,
  RunStatus.WaitingForApproval,
  RunStatus.WaitingForInput,
];

async function markSyncDegraded(run: { id: string; runtimeName: string | null }, message: string) {
  const now = new Date();
  const runtimeName = run.runtimeName ?? HERMES_EXECUTION_RUNTIME;

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

async function syncRunForRead(runId: string, client?: OpenClawRuntimeSyncClient) {
  const run = await db.run.findUniqueOrThrow({
    where: { id: runId },
    select: { id: true, runtimeName: true },
  });

  try {
    const { runtimeSync } = await import("@/modules/runtime-sync");
    await runtimeSync.syncRun({ runId, client });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime sync failed";
    await markSyncDegraded(run, message);
  }
}

export async function syncStaleWorkspaceRunsForRead(
  workspaceId: string,
  client?: OpenClawRuntimeSyncClient,
) {
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

  for (const run of runs) {
    await syncRunForRead(run.id, client);
  }
}

export async function syncTaskRunForRead(
  taskId: string,
  client?: OpenClawRuntimeSyncClient,
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

  await syncRunForRead(run.id, client);
}

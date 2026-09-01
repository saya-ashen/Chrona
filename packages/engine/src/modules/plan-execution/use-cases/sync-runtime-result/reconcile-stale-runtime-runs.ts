import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { aiClientRegistry, stableJsonHash } from "@/modules/ai";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import { syncPlanRunRuntimeResult } from "../../kernel/sync-runtime-result";
import { syncPersistedRunStateInTransaction } from "../../persistence/task-execution-store";
import { assertSchedulerWorkOwnership, withSchedulerWorkOwnership, type SchedulerWorkContext } from "@/modules/orchestration/scheduler-lease-repository";

type ReconcileOutcome = "synced" | "left_running" | "skipped";
const TERMINAL_FINALIZATION_GRACE_MS = 60_000;
const RECONCILING_SYNC_STATUSES: string[] = ["reconciling_healthy", "reconciling_degraded"];

export type ReconcileStaleRuntimeRunsResult = {
  checked: number;
  synced: number;
  leftRunning: number;
  skipped: number;
};

type RunningProviderRun = Awaited<ReturnType<typeof findRunningProviderRuns>>[number];
type CanonicalRun = NonNullable<Awaited<ReturnType<typeof db.run.findUnique>>>;
export async function reconcileStaleRuntimeRuns(input: {
  taskId?: string;
  limit?: number;
  workContext?: SchedulerWorkContext;
} = {}): Promise<ReconcileStaleRuntimeRunsResult> {
  const providerRuns = await findRunningProviderRuns(input);
  const result: ReconcileStaleRuntimeRunsResult = {
    checked: providerRuns.length,
    synced: 0,
    leftRunning: 0,
    skipped: 0,
  };

  for (const providerRun of providerRuns) {
    await assertSchedulerWorkOwnership(input.workContext);
    const outcome = await reconcileProviderRun(providerRun, input.workContext);
    await assertSchedulerWorkOwnership(input.workContext);
    if (outcome === "synced") result.synced += 1;
    if (outcome === "left_running") result.leftRunning += 1;
    if (outcome === "skipped") result.skipped += 1;
  }

  return result;
}

async function findRunningProviderRuns(input: { taskId?: string; limit?: number }) {
  const finalizationCutoff = new Date(Date.now() - TERMINAL_FINALIZATION_GRACE_MS);
  return db.taskPlanProviderRun.findMany({
    where: {
      providerRunRef: { not: null },
      taskId: input.taskId,
      nodeAttempt: { terminalActions: { none: {} } },
      runId: { not: null },
      OR: [
        {
          status: "running",
          nodeAttempt: { status: "running" },
          task: { runs: { some: { status: RunStatus.Running } } },
        },
        {
          status: { in: ["completed", "failed", "cancelled"] },
          finishedAt: { lte: finalizationCutoff },
        },
        {
          task: { runs: { some: { syncStatus: { in: RECONCILING_SYNC_STATUSES } } } },
        },
      ],
    },
    include: {
      task: { select: { defaultSessionId: true, latestRunId: true, status: true, aiClientId: true } },
      nodeAttempt: { select: { nodeId: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: input.limit ?? 25,
  });
}

export function shouldReconcileTerminalProviderRun(input: {
  providerStatus: string;
  runStatus: RunStatus;
  runId: string;
  latestRunId: string | null;
  taskStatus: string;
}) {
  if (input.runStatus === RunStatus.Pending || input.runStatus === RunStatus.Running) return true;
  return input.providerStatus === "cancelled"
    && input.runStatus === RunStatus.Cancelled
    && input.latestRunId === input.runId
    && input.taskStatus !== "Cancelled";
}

async function reconcileProviderRun(
  providerRun: RunningProviderRun,
  workContext?: SchedulerWorkContext,
): Promise<ReconcileOutcome> {
  const providerRunRef = providerRun.providerRunRef?.trim();
  if (!providerRunRef || !providerRun.runId) return "skipped";
  const run = await db.run.findFirst({
    where: { id: providerRun.runId, taskId: providerRun.taskId, providerRuns: { some: { id: providerRun.id } } },
  });
  if (!run?.runtimeRunRef) return "skipped";
  const runtimeRunRef = run.runtimeRunRef;
  if (isReconciliationProjectionPending(run.syncStatus)) {
    await syncCanonicalRunProjection(run, run.status, reconciliationTargetSyncStatus(run.syncStatus), workContext);
    return "synced";
  }
  if (providerRun.status !== "running") {
    if (!shouldReconcileTerminalProviderRun({ providerStatus: providerRun.status, runStatus: run.status, runId: run.id, latestRunId: providerRun.task.latestRunId, taskStatus: providerRun.task.status })) return "skipped";
    return reconcileTerminalProviderRecord({ providerRun, run, runtimeRunRef, workContext });
  }
  if (run.status !== RunStatus.Running) return "skipped";
  const runtimeName = providerRun.runtimeName ?? run.runtimeName;
  const providerName = await persistedProviderName(providerRun);
  await assertSchedulerWorkOwnership(workContext);
  const client = await providerClientForRecovery({
    providerName,
    aiClientId: providerRun.aiClientId,
    aiClientConfigDigest: providerRun.aiClientConfigDigest,
  });
  await assertSchedulerWorkOwnership(workContext);
  if (!client) {
    const reason = `Runtime run ${runtimeRunRef} was interrupted, but no enabled AI client can recover provider ${providerName ?? runtimeName}.`;
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      expectedAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      status: "Failed",
      error: reason,
      workContext,
    });
    await syncCanonicalRunProjection(run, RunStatus.Failed, "degraded", workContext);
    return "synced";
  }
  const capabilities = typeof client.getCapabilities === "function" ? await client.getCapabilities() : undefined;
  await assertSchedulerWorkOwnership(workContext);
  if (capabilities?.recovery?.activeRunLookup === false) {
    const reason = `Runtime run ${runtimeRunRef} was interrupted. Provider recovery mode ${capabilities.recovery.mode} cannot query active run snapshots; retry can resume from saved provider session history.`;
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      expectedAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      status: "Failed",
      error: reason,
      workContext,
    });
    await syncCanonicalRunProjection(run, RunStatus.Failed, "degraded", workContext);
    return "synced";
  }
  try {
    const snapshot = await client.getRun({ runId: providerRunRef, sessionId: run.runtimeSessionRef ?? undefined });
    await assertSchedulerWorkOwnership(workContext);
    return reconcileSnapshot({ providerRun, run, runtimeRunRef, snapshot, workContext });
  } catch (error) {
    if (!isTerminalMissingRun(error)) return "left_running";
    const reason = await missingRunReason({ providerRun, runtimeName, runtimeRunRef, error });
    await assertSchedulerWorkOwnership(workContext);
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      expectedAttemptId: providerRun.nodeAttemptId,
      providerRunId: providerRun.id,
      status: "Failed",
      error: reason,
      workContext,
    });
    await syncCanonicalRunProjection(run, RunStatus.Failed, "degraded", workContext);
    return "synced";
  }
}

async function reconcileTerminalProviderRecord(input: {
  providerRun: RunningProviderRun;
  run: CanonicalRun;
  runtimeRunRef: string;
  workContext?: SchedulerWorkContext;
}): Promise<ReconcileOutcome> {
  const reason = input.providerRun.status === "cancelled"
    ? "Provider run was cancelled before recording a Chrona terminal result action"
    : input.providerRun.status === "completed"
      ? "Provider run completed without recording a Chrona terminal result action"
      : "Provider run failed before recording a Chrona terminal result action";
  await syncPlanRunRuntimeResult({
    taskId: input.providerRun.taskId,
    runtimeRunRef: input.runtimeRunRef,
    expectedAttemptId: input.providerRun.nodeAttemptId,
    providerRunId: input.providerRun.id,
    status: "Failed",
    error: reason,
    workContext: input.workContext,
  });
  await syncCanonicalRunProjection(input.run, RunStatus.Failed, "degraded", input.workContext);
  return "synced";
}

async function persistedProviderName(providerRun: RunningProviderRun): Promise<string | null> {
  if (providerRun.lastRawEventId) {
    const lastEvent = await db.rawEventLog.findUnique({
      where: { id: providerRun.lastRawEventId },
      select: { provider: true },
    });
    if (lastEvent?.provider?.trim()) return lastEvent.provider.trim();
  }

  const providerEvent = await db.rawEventLog.findFirst({
    where: { providerRunId: providerRun.id, provider: { not: null } },
    orderBy: { occurredAt: "desc" },
    select: { provider: true },
  });
  return providerEvent?.provider?.trim() || null;
}


async function providerClientForRecovery(input: {
  providerName: string | null;
  aiClientId: string | null;
  aiClientConfigDigest: string | null;
}) {
  if (!input.aiClientId || !input.aiClientConfigDigest) return null;
  const client = await aiClientRegistry.get(input.aiClientId);
  if (!client?.record.enabled || !client.providerClient) return null;
  if (stableJsonHash(client.record.config) !== input.aiClientConfigDigest) return null;
  if (input.providerName && client.providerClient.provider !== input.providerName && client.record.type !== input.providerName) {
    return null;
  }
  return client.providerClient;
}

async function reconcileSnapshot(input: {
  providerRun: RunningProviderRun;
  run: CanonicalRun;
  runtimeRunRef: string;
  snapshot: ProviderRunSnapshot;
  workContext?: SchedulerWorkContext;
}): Promise<ReconcileOutcome> {
  if (isActiveProviderStatus(input.snapshot.status)) {
    return "left_running";
  }

  if (input.snapshot.status === "completed") {
    await syncPlanRunRuntimeResult({
      taskId: input.providerRun.taskId,
      runtimeRunRef: input.runtimeRunRef,
      expectedAttemptId: input.providerRun.nodeAttemptId,
      providerRunId: input.providerRun.id,
      status: "Completed",
      summary: input.snapshot.outputText ?? input.snapshot.output?.text,
      output: input.snapshot.output,
      workContext: input.workContext,
    });
    await syncCanonicalRunProjection(input.run, RunStatus.Completed, "healthy", input.workContext);
    return "synced";
  }

  const status = RunStatus.Failed;
  const reason = input.snapshot.error
    ?? (input.snapshot.status === "cancelled" ? "Provider run was cancelled" : "Provider run failed");
  await syncPlanRunRuntimeResult({
    taskId: input.providerRun.taskId,
    runtimeRunRef: input.runtimeRunRef,
    expectedAttemptId: input.providerRun.nodeAttemptId,
    providerRunId: input.providerRun.id,
    status: "Failed",
    error: reason,
    workContext: input.workContext,
  });
  await syncCanonicalRunProjection(input.run, status, "degraded", input.workContext);
  return "synced";
}

function isActiveProviderStatus(status: ProviderRunSnapshot["status"]) {
  return status === "running" || status === "queued" || status === "waiting_for_approval" || status === "stopping";
}

async function missingRunReason(input: {
  providerRun: RunningProviderRun;
  runtimeName: string;
  runtimeRunRef: string;
  error: unknown;
}) {
  const lastRawEvent = input.providerRun.lastRawEventId
    ? await db.rawEventLog.findUnique({
        where: { id: input.providerRun.lastRawEventId },
        select: { rawType: true, occurredAt: true },
      })
    : null;
  const status = statusFromError(input.error);
  const lastEvent = lastRawEvent?.occurredAt
    ? ` Last Chrona provider event: ${lastRawEvent.rawType} at ${lastRawEvent.occurredAt.toISOString()}.`
    : " No Chrona provider terminal event was recorded.";
  return `Runtime run ${input.runtimeRunRef} is no longer available from provider ${input.runtimeName} (HTTP ${status ?? "unknown"}).${lastEvent} Marking the node failed so execution does not remain running.`;
}



async function syncCanonicalRunProjection(
  run: CanonicalRun,
  status: RunStatus,
  syncStatus: "healthy" | "degraded",
  workContext?: SchedulerWorkContext,
) {
  await withSchedulerWorkOwnership(workContext, async (tx) => {
    await syncPersistedRunStateInTransaction({ taskId: run.taskId, runId: run.id }, tx);
    await tx.run.updateMany({
      where: { id: run.id, syncStatus: { in: RECONCILING_SYNC_STATUSES } },
      data: { syncStatus, lastSyncedAt: new Date() },
    });
  });
}

function isReconciliationProjectionPending(syncStatus: string) {
  return RECONCILING_SYNC_STATUSES.includes(syncStatus);
}

function reconciliationTargetSyncStatus(syncStatus: string): "healthy" | "degraded" {
  return syncStatus === "reconciling_degraded" ? "degraded" : "healthy";
}

function isTerminalMissingRun(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { status?: unknown; retryable?: unknown };
  return record.status === 404 && record.retryable !== true;
}

function statusFromError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

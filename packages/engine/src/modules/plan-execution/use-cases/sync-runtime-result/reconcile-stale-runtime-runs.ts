import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai";
import type { EngineAiClient } from "@/modules/ai";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import { syncPlanRunRuntimeResult } from "../../kernel/sync-runtime-result";
import { syncTaskRunState } from "../../persistence/task-execution-store";

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
type TerminalRunStatus = "Completed" | "Failed" | "Cancelled";

export async function reconcileStaleRuntimeRuns(input: {
  taskId?: string;
  limit?: number;
} = {}): Promise<ReconcileStaleRuntimeRunsResult> {
  const providerRuns = await findRunningProviderRuns(input);
  const result: ReconcileStaleRuntimeRunsResult = {
    checked: providerRuns.length,
    synced: 0,
    leftRunning: 0,
    skipped: 0,
  };

  for (const providerRun of providerRuns) {
    const outcome = await reconcileProviderRun(providerRun);
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
      task: { select: { executionRuntime: true, defaultSessionId: true, latestRunId: true, status: true, aiClientId: true } },
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

async function reconcileProviderRun(providerRun: RunningProviderRun): Promise<ReconcileOutcome> {
  const runtimeRunRef = providerRun.providerRunRef?.trim();
  if (!runtimeRunRef) return "skipped";

  const run = await db.run.findUnique({ where: { runtimeRunRef } });
  if (!run) return "skipped";
  if (isReconciliationProjectionPending(run.syncStatus)) {
    await syncCanonicalRunProjection(run, run.status, reconciliationTargetSyncStatus(run.syncStatus));
    return "synced";
  }
  if (providerRun.status !== "running") {
    if (!shouldReconcileTerminalProviderRun({
      providerStatus: providerRun.status,
      runStatus: run.status,
      runId: run.id,
      latestRunId: providerRun.task.latestRunId,
      taskStatus: providerRun.task.status,
    })) return "skipped";
    return reconcileTerminalProviderRecord({ providerRun, run, runtimeRunRef });
  }
  if (run.status !== RunStatus.Running) return "skipped";
  const runtimeName = providerRun.runtimeName ?? run.runtimeName;
  const providerName = await persistedProviderName(providerRun);
  const client = await providerClientForRecovery({
    runtimeName,
    providerName,
    aiClientId: providerRun.task.aiClientId,
  });
  if (!client) {
    const reason = `Runtime run ${runtimeRunRef} was interrupted, but no enabled AI client can recover provider ${providerName ?? runtimeName}.`;
    await markRunFailed({ run, reason, retryable: true });
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      status: "Failed",
      error: reason,
    });
    await syncCanonicalRunProjection(run, RunStatus.Failed, "degraded");
    return "synced";
  }

  const capabilities = typeof client.getCapabilities === "function" ? await client.getCapabilities() : undefined;
  if (capabilities?.recovery?.activeRunLookup === false) {
    const reason = `Runtime run ${runtimeRunRef} was interrupted. Provider recovery mode ${capabilities.recovery.mode} cannot query active run snapshots; retry can resume from saved provider session history.`;
    await markRunFailed({ run, reason, retryable: true });
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      status: "Failed",
      error: reason,
    });
    await syncCanonicalRunProjection(run, RunStatus.Failed, "degraded");
    return "synced";
  }


  try {
    const snapshot = await client.getRun({
      runId: runtimeRunRef,
      sessionId: run.runtimeSessionRef ?? undefined,
    });
    return reconcileSnapshot({ providerRun, run, runtimeRunRef, snapshot });
  } catch (error) {
    if (!isTerminalMissingRun(error)) return "left_running";

    const reason = await missingRunReason({ providerRun, runtimeName, runtimeRunRef, error });
    await markRunFailed({ run, reason });
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      status: "Failed",
      error: reason,
    });
    await syncCanonicalRunProjection(run, RunStatus.Failed, "degraded");
    return "synced";
  }
}

async function reconcileTerminalProviderRecord(input: {
  providerRun: RunningProviderRun;
  run: CanonicalRun;
  runtimeRunRef: string;
}): Promise<ReconcileOutcome> {
  if (input.providerRun.status === "cancelled") {
    const reason = "Provider run was cancelled before recording a Chrona terminal result action";
    await persistCanonicalRunTerminalState({
      run: input.run,
      status: RunStatus.Failed,
      errorSummary: reason,
      syncStatus: "degraded",
    });
    await syncPlanRunRuntimeResult({
      taskId: input.providerRun.taskId,
      runtimeRunRef: input.runtimeRunRef,
      status: "Failed",
      error: reason,
    });
    await syncCanonicalRunProjection(input.run, RunStatus.Failed, "degraded");
    return "synced";
  }

  const reason = input.providerRun.status === "completed"
    ? "Provider run completed without recording a Chrona terminal result action"
    : "Provider run failed before recording a Chrona terminal result action";
  await markRunFailed({ run: input.run, reason });
  await syncPlanRunRuntimeResult({
    taskId: input.providerRun.taskId,
    runtimeRunRef: input.runtimeRunRef,
    status: "Failed",
    error: reason,
  });
  await syncCanonicalRunProjection(input.run, RunStatus.Failed, "degraded");
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

type RecoveryClient = EngineAiClient;

export function selectRecoveryProviderClient(input: {
  runtimeName: string;
  providerName: string | null;
  taskClient: RecoveryClient | null;
  defaultClient: RecoveryClient | null;
  enabledClients: RecoveryClient[];
}) {
  const candidates = [input.taskClient, input.defaultClient, ...input.enabledClients]
    .filter((client): client is RecoveryClient => client !== null && client.providerClient !== null);
  const providerMatch = input.providerName
    ? candidates.find((client) => client.providerClient?.provider === input.providerName || client.record.type === input.providerName)
    : undefined;
  if (providerMatch?.providerClient) return providerMatch.providerClient;
  if (input.providerName) return null;

  if (input.taskClient?.providerClient) return input.taskClient.providerClient;
  if (input.defaultClient?.providerClient) return input.defaultClient.providerClient;
  return candidates.find((client) => client.record.type === input.runtimeName)?.providerClient ?? null;
}

async function providerClientForRecovery(input: {
  runtimeName: string;
  providerName: string | null;
  aiClientId: string | null;
}) {
  const [taskClient, defaultClient, clientRecords] = await Promise.all([
    input.aiClientId ? aiClientRegistry.get(input.aiClientId) : Promise.resolve(null),
    aiClientRegistry.get(),
    aiClientRegistry.list(),
  ]);
  const enabledClients = await Promise.all(
    clientRecords
      .filter((client) => client.enabled)
      .map((client) => aiClientRegistry.get(client.id)),
  );
  return selectRecoveryProviderClient({
    runtimeName: input.runtimeName,
    providerName: input.providerName,
    taskClient,
    defaultClient,
    enabledClients: enabledClients.filter((client): client is RecoveryClient => client !== null),
  });
}

async function reconcileSnapshot(input: {
  providerRun: RunningProviderRun;
  run: CanonicalRun;
  runtimeRunRef: string;
  snapshot: ProviderRunSnapshot;
}): Promise<ReconcileOutcome> {
  if (isActiveProviderStatus(input.snapshot.status)) {
    return "left_running";
  }

  if (input.snapshot.status === "completed") {
    await persistCanonicalRunTerminalState({
      run: input.run,
      status: RunStatus.Completed,
      errorSummary: null,
      syncStatus: "healthy",
    });
    await syncPlanRunRuntimeResult({
      taskId: input.providerRun.taskId,
      runtimeRunRef: input.runtimeRunRef,
      status: "Completed",
      summary: input.snapshot.outputText,
      output: input.snapshot.structuredPayload ?? input.snapshot.output ?? input.snapshot.raw,
    });
    await syncCanonicalRunProjection(input.run, RunStatus.Completed, "healthy");
    return "synced";
  }

  const providerCancelled = input.snapshot.status === "cancelled";
  const status = RunStatus.Failed;
  const reason = input.snapshot.error
    ?? (providerCancelled
      ? "Provider run was cancelled before recording a Chrona terminal result action"
      : `Runtime run ${input.runtimeRunRef} ${input.snapshot.status}`);
  await persistCanonicalRunTerminalState({
    run: input.run,
    status,
    errorSummary: reason,
    syncStatus: providerCancelled ? "degraded" : "healthy",
  });
  await syncPlanRunRuntimeResult({
    taskId: input.providerRun.taskId,
    runtimeRunRef: input.runtimeRunRef,
    status: "Failed",
    error: reason,
    summary: input.snapshot.outputText,
    output: input.snapshot.structuredPayload ?? input.snapshot.output ?? input.snapshot.raw,
  });
  await syncCanonicalRunProjection(input.run, status, providerCancelled ? "degraded" : "healthy");
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

async function markRunFailed(input: {
  run: CanonicalRun;
  reason: string;
  retryable?: boolean;
}) {
  await persistCanonicalRunTerminalState({
    run: input.run,
    status: RunStatus.Failed,
    errorSummary: input.reason,
    syncStatus: "degraded",
    retryable: input.retryable,
  });
}

async function persistCanonicalRunTerminalState(input: {
  run: CanonicalRun;
  status: TerminalRunStatus;
  errorSummary: string | null;
  syncStatus: "healthy" | "degraded";
  retryable?: boolean;
}) {
  await db.run.update({
    where: { id: input.run.id },
    data: {
      status: input.status,
      endedAt: new Date(),
      errorSummary: input.errorSummary,
      syncStatus: `reconciling_${input.syncStatus}`,
      lastSyncedAt: new Date(),
      retryable: input.retryable ?? false,
      pendingInputPrompt: null,
    },
  });
}

async function syncCanonicalRunProjection(
  run: CanonicalRun,
  status: RunStatus,
  syncStatus: "healthy" | "degraded",
) {
  await syncTaskRunState({
    taskId: run.taskId,
    taskSessionId: run.taskSessionId,
    runId: run.id,
    runStatus: status,
    runtimeRunRef: run.runtimeRunRef,
  });
  await db.run.updateMany({
    where: { id: run.id, syncStatus: { in: RECONCILING_SYNC_STATUSES } },
    data: { syncStatus, lastSyncedAt: new Date() },
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

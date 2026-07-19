import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import { syncPlanRunRuntimeResult } from "../../kernel/sync-runtime-result";
import { syncTaskRunState } from "../../persistence/task-execution-store";

type ReconcileOutcome = "synced" | "left_running" | "skipped";
const TERMINAL_FINALIZATION_GRACE_MS = 60_000;

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
      ],
    },
    include: {
      task: { select: { executionRuntime: true, defaultSessionId: true, latestRunId: true, status: true } },
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
  const client = await providerClientForRuntime(runtimeName);
  if (!client) {
    return "skipped";
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
    await syncCanonicalRunProjection(run, RunStatus.Failed);
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
    await syncCanonicalRunProjection(run, RunStatus.Failed);
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
    await syncCanonicalRunProjection(input.run, RunStatus.Failed);
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
  await syncCanonicalRunProjection(input.run, RunStatus.Failed);
  return "synced";
}

async function providerClientForRuntime(runtimeName: string) {
  const defaultClient = await aiClientRegistry.get();
  if (defaultClient?.record.type === runtimeName && defaultClient.providerClient) {
    return defaultClient.providerClient;
  }

  const clients = await aiClientRegistry.list();
  const matchingClient = clients.find((client) => client.type === runtimeName && client.enabled);
  if (!matchingClient) return null;

  const resolvedClient = await aiClientRegistry.get(matchingClient.id);
  return resolvedClient?.providerClient ?? null;
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
    await syncCanonicalRunProjection(input.run, RunStatus.Completed);
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
  await syncCanonicalRunProjection(input.run, status);
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
      syncStatus: input.syncStatus,
      lastSyncedAt: new Date(),
      retryable: input.retryable ?? false,
      pendingInputPrompt: null,
    },
  });
}

async function syncCanonicalRunProjection(
  run: CanonicalRun,
  status: RunStatus,
) {
  await syncTaskRunState({
    taskId: run.taskId,
    taskSessionId: run.taskSessionId,
    runId: run.id,
    runStatus: status,
    runtimeRunRef: run.runtimeRunRef,
  });
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

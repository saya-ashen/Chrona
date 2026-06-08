import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { aiClientRegistry } from "@/modules/ai";
import type { ProviderRunSnapshot } from "@chrona/providers-foundation";
import { syncPlanRunRuntimeResult } from "../../kernel/sync-runtime-result";

type ReconcileOutcome = "synced" | "left_running" | "skipped";

export type ReconcileStaleRuntimeRunsResult = {
  checked: number;
  synced: number;
  leftRunning: number;
  skipped: number;
};

type RunningProviderRun = Awaited<ReturnType<typeof findRunningProviderRuns>>[number];

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
  return db.taskPlanProviderRun.findMany({
    where: {
      status: "running",
      providerRunRef: { not: null },
      taskId: input.taskId,
      nodeAttempt: { status: "running" },
      task: { runs: { some: { status: RunStatus.Running } } },
    },
    include: {
      task: { select: { executionRuntime: true, defaultSessionId: true } },
      nodeAttempt: { select: { nodeId: true } },
    },
    orderBy: { updatedAt: "asc" },
    take: input.limit ?? 25,
  });
}

async function reconcileProviderRun(providerRun: RunningProviderRun): Promise<ReconcileOutcome> {
  const runtimeRunRef = providerRun.providerRunRef?.trim();
  if (!runtimeRunRef) return "skipped";

  const run = await db.run.findUnique({ where: { runtimeRunRef } });
  if (!run || run.status !== RunStatus.Running) return "skipped";

  const runtimeName = providerRun.runtimeName ?? run.runtimeName;
  const client = await providerClientForRuntime(runtimeName);
  if (!client) {
    return "skipped";
  }

  try {
    const snapshot = await client.getRun({
      runId: runtimeRunRef,
      sessionId: run.runtimeSessionRef ?? undefined,
    });
    return reconcileSnapshot({ providerRun, runId: run.id, runtimeRunRef, snapshot });
  } catch (error) {
    if (!isTerminalMissingRun(error)) return "left_running";

    const reason = await missingRunReason({ providerRun, runtimeName, runtimeRunRef, error });
    await markRunFailed({ runId: run.id, reason });
    await syncPlanRunRuntimeResult({
      taskId: providerRun.taskId,
      runtimeRunRef,
      status: "Failed",
      error: reason,
    });
    return "synced";
  }
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
  runId: string;
  runtimeRunRef: string;
  snapshot: ProviderRunSnapshot;
}): Promise<ReconcileOutcome> {
  if (isActiveProviderStatus(input.snapshot.status)) {
    return "left_running";
  }

  if (input.snapshot.status === "completed") {
    await db.run.update({
      where: { id: input.runId },
      data: {
        status: RunStatus.Completed,
        endedAt: new Date(),
        errorSummary: null,
        syncStatus: "healthy",
        lastSyncedAt: new Date(),
      },
    });
    await syncPlanRunRuntimeResult({
      taskId: input.providerRun.taskId,
      runtimeRunRef: input.runtimeRunRef,
      status: "Completed",
      summary: input.snapshot.outputText,
      output: input.snapshot.structuredPayload ?? input.snapshot.output ?? input.snapshot.raw,
    });
    return "synced";
  }

  const status = input.snapshot.status === "cancelled" ? "Cancelled" : "Failed";
  const reason = input.snapshot.error ?? `Runtime run ${input.runtimeRunRef} ${input.snapshot.status}`;
  await db.run.update({
    where: { id: input.runId },
    data: {
      status: status === "Cancelled" ? RunStatus.Cancelled : RunStatus.Failed,
      endedAt: new Date(),
      errorSummary: status === "Cancelled" ? null : reason,
      syncStatus: "healthy",
      lastSyncedAt: new Date(),
    },
  });
  await syncPlanRunRuntimeResult({
    taskId: input.providerRun.taskId,
    runtimeRunRef: input.runtimeRunRef,
    status,
    error: status === "Failed" ? reason : undefined,
    summary: input.snapshot.outputText,
    output: input.snapshot.structuredPayload ?? input.snapshot.output ?? input.snapshot.raw,
  });
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

async function markRunFailed(input: { runId: string; reason: string }) {
  await db.run.update({
    where: { id: input.runId },
    data: {
      status: RunStatus.Failed,
      endedAt: new Date(),
      errorSummary: input.reason,
      syncStatus: "degraded",
      lastSyncedAt: new Date(),
      retryable: false,
    },
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

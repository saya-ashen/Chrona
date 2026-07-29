import type { AgentProviderClient, ProviderRunEvent, ProviderRunRef, ProviderRunSnapshot, StartRunInput } from "@chrona/providers-foundation";
import { collectProviderRunSnapshot } from "./ai-runtime-stream-collection";
import { persistRuntimeRunRef, updateProviderRunRecord } from "./ai-runtime-persistence";
import { toStartRunInput, type ExecutionProviderRequest } from "./ai-runtime-request";
import type { RuntimeEventPersistenceContext } from "./ai-runtime-event-persistence";

const TRANSIENT_PROVIDER_ERROR_CODES = new Set(["aborted", "network_error", "provider_error", "rate_limited", "incomplete_stream"]);
const PROVIDER_RETRY_BACKOFF_MS = 1_000;

type ProviderClient = AgentProviderClient;

type ProviderRunRequestOptions = {
  runId?: string;
  idempotencyKey?: string;
  providerRunRecordId?: string;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  terminalToolName?: string;
  eventPersistence?: RuntimeEventPersistenceContext;
  signal?: AbortSignal;
  controlRunToken?: string | null;
  onRunStarted?: (run: ProviderRunRef) => Promise<void> | void;
};

export async function runProviderRequest(
  providerClient: ProviderClient,
  request: ExecutionProviderRequest,
  options: ProviderRunRequestOptions = {},
): Promise<ProviderRunSnapshot> {
  const run = await startProviderRun(providerClient, request, options);
  const cancel = () => cancelProviderRun(providerClient, run, options.providerRunRecordId);
  if (options.signal?.aborted) return cancel();
  try {
    const snapshot = await streamProviderRun(providerClient, run, options);
    return options.signal?.aborted ? cancel() : snapshot;
  } catch (error) {
    if (!isTransientProviderError(error)) throw error;
    return resumeOrReconcileProviderRun(providerClient, run, options, cancel);
  }
}

async function startProviderRun(providerClient: ProviderClient, request: ExecutionProviderRequest, options: ProviderRunRequestOptions): Promise<ProviderRunRef> {
  const input = sanitizeStartRunInputForProvider(providerClient.provider, toStartRunInput(request));
  const run = await providerClient.startRun({
    ...input,
    signal: options.signal,
    idempotencyKey: options.idempotencyKey ?? (options.runId ? `chrona-runtime:${options.runId}` : undefined),
    control: controlForRun(providerClient.provider, options.controlRunToken),
  } as StartRunInput);
  await persistRuntimeRunRef(options.runId, run);
  await options.onRunStarted?.(run);
  await updateProviderRunRecord(options.providerRunRecordId, {
    providerRunRef: run.nativeRunId ?? run.runId,
    nativeRunId: run.nativeRunId ?? null,
    status: run.status ?? "running",
  });
  return run;
}

function controlForRun(provider: string, token: string | null | undefined) {
  return usesChronaControlPlane(provider) && token ? { baseUrl: resolveChronaControlBaseUrl(), runToken: token } : undefined;
}

async function streamProviderRun(providerClient: ProviderClient, run: ProviderRunRef, options: ProviderRunRequestOptions): Promise<ProviderRunSnapshot> {
  return collectProviderRunSnapshot(
    providerClient.provider,
    providerClient.streamRun({ runId: run.runId, sessionId: run.sessionId, signal: options.signal, include: { rawEvents: true } }),
    run.sessionId,
    run,
    options,
  );
}

async function resumeOrReconcileProviderRun(
  providerClient: ProviderClient,
  run: ProviderRunRef,
  options: ProviderRunRequestOptions,
  cancel: () => Promise<ProviderRunSnapshot>,
): Promise<ProviderRunSnapshot> {
  await delay(PROVIDER_RETRY_BACKOFF_MS);
  try {
    const snapshot = await streamProviderRun(providerClient, run, options);
    return options.signal?.aborted ? cancel() : snapshot;
  } catch (error) {
    if (!isTransientProviderError(error)) throw error;
    return reconcileInterruptedRun(providerClient, run, options.signal);
  }
}

async function cancelProviderRun(providerClient: ProviderClient, run: ProviderRunRef, providerRunRecordId: string | undefined): Promise<ProviderRunSnapshot> {
  const snapshot = await providerClient.cancelRun({ runId: run.runId, sessionId: run.sessionId, reason: "Execution stopped" }).catch(() => null);
  await updateProviderRunRecord(providerRunRecordId, { status: "cancelled", finishedAt: new Date() });
  return { ...(snapshot ?? cancelledSnapshot(providerClient.provider, run)), status: "cancelled", error: snapshot?.error ?? null };
}

function cancelledSnapshot(provider: string, run: ProviderRunRef): ProviderRunSnapshot {
  return { provider, runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, status: "cancelled", error: null };
}

async function reconcileInterruptedRun(providerClient: ProviderClient, run: ProviderRunRef, signal?: AbortSignal): Promise<ProviderRunSnapshot> {
  const capabilities = await providerClient.getCapabilities();
  if (capabilities.recovery?.activeRunLookup === false) return recoveryUnavailableSnapshot(providerClient.provider, run, capabilities.recovery.mode);
  try {
    return await providerClient.getRun({ runId: run.runId, sessionId: run.sessionId, signal });
  } catch {
    return { provider: providerClient.provider, runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, status: "running", error: null };
  }
}

function recoveryUnavailableSnapshot(provider: string, run: ProviderRunRef, mode: string): ProviderRunSnapshot {
  return {
    provider,
    runId: run.runId,
    nativeRunId: run.nativeRunId,
    sessionId: run.sessionId,
    status: "failed",
    rawStatus: "interrupted",
    error: `Provider recovery mode ${mode} cannot reconnect active run ${run.runId}. Retry can resume from saved provider session history.`,
  };
}

function sanitizeStartRunInputForProvider(provider: string, input: StartRunInput): StartRunInput {
  if (provider !== "claude_code" || !input.resumeSessionRef?.startsWith("claude-sdk-")) return input;
  const next = { ...input };
  delete next.resumeSessionRef;
  return next;
}

function usesChronaControlPlane(providerName: string): boolean {
  return providerName === "claude_code" || providerName === "codex" || providerName === "omp";
}

function resolveChronaControlBaseUrl(): string {
  return process.env.CHRONA_BASE_URL?.trim() || `http://127.0.0.1:${process.env.PORT?.trim() || "3101"}/api`;
}

function isTransientProviderError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; status?: unknown; retryable?: unknown };
  return record.retryable === true
    || (typeof record.status === "number" && (record.status === 429 || record.status >= 500))
    || (typeof record.code === "string" && TRANSIENT_PROVIDER_ERROR_CODES.has(record.code));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

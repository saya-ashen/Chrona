import { assertProviderStartSupported, ProviderOperationError, type AgentProviderClient, type ProviderCapabilities, type ProviderRunEvent, type ProviderRunRef, type ProviderRunSnapshot, type StartRunInput } from "@chrona/providers-foundation";
import { collectProviderRunSnapshot } from "./ai-runtime-stream-collection";
import { persistRuntimeRunRef, updateProviderRunRecord } from "./ai-runtime-persistence";
import { toStartRunInput, type ExecutionProviderRequest } from "./ai-runtime-request";
import { persistProviderRuntimeEvent, type RuntimeEventPersistenceContext } from "./ai-runtime-event-persistence";

const TRANSIENT_PROVIDER_ERROR_CODES = new Set(["aborted", "network_error", "provider_error", "rate_limited", "incomplete_stream"]);
const PROVIDER_RETRY_BACKOFF_MS = 1_000;
const TERMINAL_ACTION_ABORT_REASON = "Chrona terminal action recorded";

type ProviderClient = AgentProviderClient;

type ProviderRunRequestOptions = {
  runId?: string;
  idempotencyKey?: string;
  clientOperationId?: string;
  providerRunRecordId?: string;
  providerRunIdentity?: "created" | "existing";
  existingRunRef?: ProviderRunRef;
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
  const run = options.providerRunIdentity === "existing"
    ? await attachProviderRun(providerClient, request, options)
    : await startProviderRun(providerClient, request, options);
  const cancel = () => cancelProviderRun(providerClient, run, options.providerRunRecordId, options.eventPersistence);
  if (options.signal?.aborted && !isTerminalActionAbort(options.signal)) return cancel();
  let snapshot: ProviderRunSnapshot;
  try {
    snapshot = await streamProviderRun(providerClient, run, options);
    if (options.signal?.aborted && !isTerminalActionAbort(options.signal)) {
      snapshot = preserveProviderIdentity(await cancel(), snapshot);
    }
  } catch (error) {
    if (!isTransientProviderError(error)) throw error;
    snapshot = await resumeOrReconcileProviderRun(providerClient, run, options, cancel);
  }
  await publishProviderResponseEvent(providerClient.provider, run, snapshot, options);
  return snapshot;
}

async function attachProviderRun(providerClient: ProviderClient, request: ExecutionProviderRequest, options: ProviderRunRequestOptions): Promise<ProviderRunRef> {
  const run = options.existingRunRef ?? await lookupExistingProviderRun(providerClient, request, options);
  await persistAttachedProviderRun(run, options);
  return run;
}

async function lookupExistingProviderRun(providerClient: ProviderClient, request: ExecutionProviderRequest, options: ProviderRunRequestOptions): Promise<ProviderRunRef> {
  const capabilities = await providerClient.getCapabilities();
  const clientOperationId = options.clientOperationId ?? options.runId ?? request.clientOperationId;
  if (!canLookupClientOperation(capabilities) || !providerClient.findRunByClientOperationId) {
    throw new ProviderOperationError({
      code: "provider_start_outcome_unknown",
      provider: providerClient.provider,
      message: `${providerClient.provider} cannot repair an existing provider run without a persisted provider run ref.`,
    });
  }
  const run = await providerClient.findRunByClientOperationId({ clientOperationId, signal: options.signal });
  if (!run) {
    throw new ProviderOperationError({
      code: "provider_start_outcome_unknown",
      provider: providerClient.provider,
      message: `${providerClient.provider} has no provider run for clientOperationId ${clientOperationId}.`,
    });
  }
  return run;
}

function canLookupClientOperation(capabilities: ProviderCapabilities): boolean {
  return capabilities.startIdempotency === "client_operation_id" || capabilities.lookupByClientOperationId === true;
}

async function persistAttachedProviderRun(run: ProviderRunRef, options: ProviderRunRequestOptions): Promise<void> {
  await persistRuntimeRunRef(options.runId, run, options.eventPersistence);
  await options.onRunStarted?.(run);
  await updateProviderRunRecord(options.providerRunRecordId, {
    providerRunRef: run.nativeRunId ?? run.runId,
    nativeRunId: run.nativeRunId ?? null,
    status: run.status ?? "running",
  }, options.eventPersistence);
}

async function startProviderRun(providerClient: ProviderClient, request: ExecutionProviderRequest, options: ProviderRunRequestOptions): Promise<ProviderRunRef> {
  const input = sanitizeStartRunInputForProvider(providerClient.provider, toStartRunInput(request));
  const clientOperationId = options.clientOperationId ?? options.runId ?? input.clientOperationId;
  assertProviderStartSupported(await providerClient.getCapabilities(), input, providerClient.provider);
  const run = await providerClient.startRun({
    ...input,
    clientOperationId,
    signal: options.signal,
    control: controlForRun(providerClient.provider, options.controlRunToken),
  });
  try {
    await persistRuntimeRunRef(options.runId, run, options.eventPersistence);
    await options.onRunStarted?.(run);
    await publishProviderRequestEvent(providerClient.provider, run, input, options);
    await updateProviderRunRecord(options.providerRunRecordId, {
      providerRunRef: run.nativeRunId ?? run.runId,
      nativeRunId: run.nativeRunId ?? null,
      status: run.status ?? "running",
    }, options.eventPersistence);
    return run;
  } catch (error) {
    await providerClient.cancelRun({
      runId: run.runId,
      sessionId: run.sessionId,
      reason: "Durable execution ownership was lost",
    }).catch(() => null);
    throw error;
  }
}

async function publishProviderRequestEvent(
  provider: string,
  run: ProviderRunRef,
  input: StartRunInput,
  options: ProviderRunRequestOptions,
) {
  const event: ProviderRunEvent = {
    type: "raw_event",
    provider,
    runId: run.runId,
    nativeRunId: run.nativeRunId,
    sessionId: run.sessionId,
    nativeSessionId: run.nativeSessionId,
    timestamp: new Date().toISOString(),
    raw: {
      kind: "provider_request",
      input,
    },
  };
  await options.onRuntimeEvent?.(event);
  await persistProviderRuntimeEvent({ context: options.eventPersistence, event, fallbackIndex: 0 });
}

async function publishProviderResponseEvent(
  provider: string,
  run: ProviderRunRef,
  output: ProviderRunSnapshot,
  options: ProviderRunRequestOptions,
) {
  const event: ProviderRunEvent = {
    type: "raw_event",
    provider,
    runId: run.runId,
    nativeRunId: run.nativeRunId,
    sessionId: run.sessionId,
    nativeSessionId: run.nativeSessionId,
    timestamp: new Date().toISOString(),
    raw: {
      kind: "provider_response",
      output,
    },
  };
  await options.onRuntimeEvent?.(event);
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
    if (!options.signal?.aborted || isTerminalActionAbort(options.signal)) return snapshot;
    return preserveProviderIdentity(await cancel(), snapshot);
  } catch (error) {
    if (!isTransientProviderError(error)) throw error;
    return reconcileInterruptedRun(providerClient, run, options.signal);
  }
}

async function cancelProviderRun(
  providerClient: ProviderClient,
  run: ProviderRunRef,
  providerRunRecordId: string | undefined,
  scope: RuntimeEventPersistenceContext | undefined,
): Promise<ProviderRunSnapshot> {
  const snapshot = await providerClient.cancelRun({ runId: run.runId, sessionId: run.sessionId, reason: "Execution stopped" }).catch(() => null);
  await updateProviderRunRecord(
    providerRunRecordId,
    { status: "cancelled", finishedAt: new Date() },
    scope,
    { providerRunStatuses: ["running", "waiting_for_approval", "completed", "failed", "cancelled"] },
  );
  return { ...(snapshot ?? cancelledSnapshot(providerClient.provider, run)), status: "cancelled", error: snapshot?.error ?? null };
}

function cancelledSnapshot(provider: string, run: ProviderRunRef): ProviderRunSnapshot {
  return { provider, runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, nativeSessionId: run.nativeSessionId, status: "cancelled", error: null };
}

function isTerminalActionAbort(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason === TERMINAL_ACTION_ABORT_REASON;
}

function preserveProviderIdentity(
  snapshot: ProviderRunSnapshot,
  observed: ProviderRunSnapshot,
): ProviderRunSnapshot {
  return {
    ...snapshot,
    runId: snapshot.runId || observed.runId,
    nativeRunId: snapshot.nativeRunId ?? observed.nativeRunId,
    sessionId: snapshot.sessionId || observed.sessionId,
    nativeSessionId: snapshot.nativeSessionId ?? observed.nativeSessionId,
  };
}

async function reconcileInterruptedRun(providerClient: ProviderClient, run: ProviderRunRef, signal?: AbortSignal): Promise<ProviderRunSnapshot> {
  const capabilities = await providerClient.getCapabilities();
  if (capabilities.recovery?.activeRunLookup === false) return recoveryUnavailableSnapshot(providerClient.provider, run, capabilities.recovery.mode);
  try {
    return await providerClient.getRun({ runId: run.runId, sessionId: run.sessionId, signal });
  } catch {
    return { provider: providerClient.provider, runId: run.runId, nativeRunId: run.nativeRunId, sessionId: run.sessionId, nativeSessionId: run.nativeSessionId, status: "running", error: null };
  }
}

function recoveryUnavailableSnapshot(provider: string, run: ProviderRunRef, mode: string): ProviderRunSnapshot {
  return {
    provider,
    runId: run.runId,
    nativeRunId: run.nativeRunId,
    sessionId: run.sessionId,
    nativeSessionId: run.nativeSessionId,
    status: "failed",
    rawStatus: "interrupted",
    outcomeCode: "provider_run_unrecoverable",
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

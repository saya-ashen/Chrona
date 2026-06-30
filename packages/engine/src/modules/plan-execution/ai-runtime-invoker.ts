import { RunStatus } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import {
  appendCanonicalEvent,
  appendRawEventLog,
} from "@/modules/events";
import type { PreparedAiFeatureSpec } from "@chrona/contracts/ai";
import type { NodeAttempt } from "@chrona/contracts/ai";
import type {
  ProviderRunEvent,
  ProviderRunSnapshot,
  ProviderRunInput,
  ProviderRunRef,
  StartRunInput,
  StartRunInputWithControl,
} from "@chrona/providers-foundation";
import { requireAiClient } from "@/modules/ai";
import { mintRunToken } from "./runtime/agent-control-store";

type ProviderChatHistory = {
  messages: Array<{ role: string; content: string }>;
};

type ExecutionProviderRequest = {
  sessionId: string;
  sessionKey: string;
  instructions: string;
  input: unknown;
  structuredOutputSchema?: PreparedAiFeatureSpec["structuredOutputSchema"];
  terminalToolName?: string;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
  resumeSessionRef?: string;
};

export type AiRuntimeInvocationInput = {
  taskId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  workBlockId?: string | null;
  nodeContext?: {
    nodeId: string;
    nodeTitle: string;
  };
  nodeAttemptId?: string;
  nodeAttempt?: NodeAttempt;
  providerRunIdempotencyKey?: string;
  runtimeInput: Record<string, unknown>;
  instructions: string;
  featureSpec: PreparedAiFeatureSpec;
  triggeredBy: "system" | "user";
  clientId?: string | null;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  signal?: AbortSignal;
};

export type AiRuntimeInvocation = {
  runId: string;
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  conversationEntryIds: string[];
  response: ProviderRunSnapshot;
  /**
   * Plain run token minted for this invocation; null if the active provider is
   * not `claude_code` or the caller did not opt into skill-mode control plane.
   * Exposed only to the engine + provider; the CLI receives it via env.
   */
  controlRunToken: string | null;
  providerName: string;
};

const TRANSIENT_PROVIDER_ERROR_CODES = new Set([
  "aborted",
  "network_error",
  "provider_error",
  "rate_limited",
  "incomplete_stream",
]);

const PROVIDER_RETRY_BACKOFF_MS = 1_000;

/**
 * Raised when a provider event stream ends (cleanly or via an interrupted
 * socket) without emitting a terminal run event. Marked retryable so the
 * caller reconnects and, failing that, reconciles the authoritative run state
 * via getRun instead of falsely recording the run as failed.
 */
class IncompleteRunStreamError extends Error {
  readonly code = "incomplete_stream";
  readonly retryable = true;

  constructor() {
    super("Provider run stream ended without a terminal event");
    this.name = "IncompleteRunStreamError";
  }
}

export class AiRuntimeInvoker {
  async invoke(input: AiRuntimeInvocationInput): Promise<AiRuntimeInvocation> {
    const task = await db.task.findUniqueOrThrow({
      where: { id: input.taskId },
      select: { workspaceId: true },
    });
    const run = await db.run.create({
      data: {
        taskId: input.taskId,
        workBlockId: input.workBlockId ?? null,
        taskSessionId: input.taskSessionId,
        runtimeName: input.runtimeName,
        runtimeSessionRef: input.runtimeSessionKey,
        status: RunStatus.Pending,
        triggeredBy: input.triggeredBy,
        startedAt: new Date(),
        syncStatus: "healthy",
      },
    });

    try {
      const client = await requireAiClient(input.clientId);
      if (!client.providerClient) {
        throw new Error(
          `AI client '${client.record.name}' does not support runtime execution`,
        );
      }
      const providerName = client.providerClient.provider;
      const useSkillControl = providerName === "claude_code";
      let controlRunToken: string | null = null;
      if (useSkillControl) {
        controlRunToken = await mintRunToken({
          taskId: input.taskId,
          workspaceId: task.workspaceId,
          taskSessionId: input.taskSessionId,
          runId: run.id,
          runtimeSessionKey: input.runtimeSessionKey,
          nodeId: input.nodeContext?.nodeId,
          nodeAttemptId: input.nodeAttemptId,
        });
      }

      // Resume the prior provider conversation across process restarts: the
      // runner's in-process SDK-session cache is empty on a fresh process, so
      // seed it from the durable id captured on the Chrona TaskSession.
      const priorProviderSessionRef = await readTaskSessionProviderRef(
        input.taskSessionId,
      );
      const request = buildExecutionGatewayRequest({
        instructions: input.instructions,
        runtimeInput: input.runtimeInput,
        featureSpec: input.featureSpec,
        sessionKey: input.runtimeSessionKey,
        sessionId: input.runtimeSessionKey,
        executionRuntime: input.runtimeName,
        resumeSessionRef: priorProviderSessionRef,
      });
      const terminalToolName = request.terminalToolName;
      const providerRun = await ensureProviderRunRecord({
        taskId: input.taskId,
        workspaceId: task.workspaceId,
        nodeAttempt: input.nodeAttempt,
        nodeAttemptId: input.nodeAttemptId,
        providerRunIdempotencyKey: input.providerRunIdempotencyKey,
      });
      const response = await runProviderRequest(client.providerClient, request, {
        runId: run.id,
        idempotencyKey: input.providerRunIdempotencyKey,
        providerRunRecordId: providerRun?.id,
        controlRunToken,
        onRuntimeEvent: input.onRuntimeEvent,
        terminalToolName,
        eventPersistence: {
          workspaceId: task.workspaceId,
          taskId: input.taskId,
          workBlockId: input.workBlockId,
          runId: run.id,
          runtimeName: input.runtimeName,
          taskSessionId: input.taskSessionId,
          nodeAttemptId: input.nodeAttemptId,
          providerRunId: providerRun?.id,
          planId: input.nodeAttempt?.graphId,
          planRunId: providerRun?.planRunId,
          nodeContext: input.nodeContext,
        },
        signal: input.signal,
      });
      const runtimeSessionKey = requireRuntimeSessionId(
        response.sessionId,
        "provider snapshot",
      );
      const runtimeRunRef = await uniqueRuntimeRunRef(run.id, response.nativeRunId ?? response.runId);
      const conversationEntryIds = await persistRuntimeHistory({
        runId: run.id,
        request,
        response,
      });

      await db.run.update({
        where: { id: run.id },
        data: {
          runtimeRunRef,
          runtimeSessionRef: runtimeSessionKey,
          status: response.error ? RunStatus.Failed : RunStatus.Running,
          syncStatus: "healthy",
          errorSummary: response.error,
        },
      });
      // Persist the provider-native session id for cross-process resume. The
      // runner rewrites the run ref's sessionId to the captured SDK
      // `session_id`, so when it differs from the engine session key it is the
      // authoritative provider id worth remembering on the TaskSession.
      if (runtimeSessionKey !== input.runtimeSessionKey) {
        await persistTaskSessionProviderRef(input.taskSessionId, runtimeSessionKey);
      }
      await updateProviderRunRecord(providerRun?.id, {
        providerRunRef: runtimeRunRef,
        runtimeName: input.runtimeName,
        nativeRunId: response.nativeRunId ?? null,
        status: response.error ? "failed" : response.status,
        finishedAt: response.status === "completed" || response.error ? new Date() : null,
      });

      return {
        runId: run.id,
        runtimeRunRef,
        runtimeSessionKey,
        conversationEntryIds,
        response,
        controlRunToken,
        providerName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db.run.update({
        where: { id: run.id },
        data: { status: RunStatus.Failed, errorSummary: message },
      });
      if (input.providerRunIdempotencyKey) {
        const existingProviderRun = await db.taskPlanProviderRun.findUnique({
          where: { idempotencyKey: input.providerRunIdempotencyKey },
          select: { id: true },
        });
        await updateProviderRunRecord(existingProviderRun?.id, {
          status: "failed",
          finishedAt: new Date(),
        });
      }
      throw error;
    }
  }
}

function toStartRunInput(request: ExecutionProviderRequest): StartRunInput {
  return {
    sessionId: request.sessionId,
    sessionKey: request.sessionKey,
    instructions: request.instructions,
    input: request.input as ProviderRunInput,
    maxOutputTokens: request.maxOutputTokens,
    ...(request.resumeSessionRef
      ? { resumeSessionRef: request.resumeSessionRef }
      : {}),
    timeoutMs: request.timeoutSeconds
      ? request.timeoutSeconds * 1000
      : undefined,
    stream: true,
  };
}

export async function runProviderRequest(
  providerClient: NonNullable<Awaited<ReturnType<typeof requireAiClient>>["providerClient"]>,
  request: ExecutionProviderRequest,
  options: {
    runId?: string;
    idempotencyKey?: string;
    providerRunRecordId?: string;
    controlRunToken?: string | null;
    onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
    terminalToolName?: string;
    eventPersistence?: RuntimeEventPersistenceContext;
    signal?: AbortSignal;
  } = {},
): Promise<ProviderRunSnapshot> {
  const startInput = toStartRunInput(request);
  const idempotencyKey = options.idempotencyKey ?? (options.runId
    ? `chrona-runtime:${options.runId}`
    : undefined);
  const controlPlane = providerClient.provider === "claude_code" && options.controlRunToken
    ? {
        baseUrl: process.env.CHRONA_BASE_URL ?? "",
        runToken: options.controlRunToken,
        skillsDir: process.env.CHRONA_SKILLS_DIR ?? "",
        skillName: process.env.CHRONA_SKILL_NAME ?? undefined,
      }
    : undefined;
  const run = await providerClient.startRun({
    ...startInput,
    signal: options.signal,
    idempotencyKey,
    ...(controlPlane ? { control: controlPlane } : {}),
  } as StartRunInputWithControl & { idempotencyKey?: string });
  await persistRuntimeRunRef(options.runId, run);
  await updateProviderRunRecord(options.providerRunRecordId, {
    providerRunRef: run.nativeRunId ?? run.runId,
    nativeRunId: run.nativeRunId ?? null,
    status: run.status ?? "running",
  });

  const cancelProviderRun = async (): Promise<ProviderRunSnapshot> => {
    const snapshot = await providerClient.cancelRun?.({
      runId: run.runId,
      sessionId: run.sessionId,
      reason: "Execution stopped",
    }).catch(() => null);
    const cancelledSnapshot: ProviderRunSnapshot = snapshot ?? {
      provider: providerClient.provider,
      runId: run.runId,
      nativeRunId: run.nativeRunId,
      sessionId: run.sessionId,
      status: "cancelled",
      error: null,
    };
    await updateProviderRunRecord(options.providerRunRecordId, {
      status: "cancelled",
      finishedAt: new Date(),
    });
    return { ...cancelledSnapshot, status: "cancelled", error: cancelledSnapshot.error ?? null };
  };

  if (options.signal?.aborted) {
    return cancelProviderRun();
  }

  try {
    const snapshot = await collectProviderRunSnapshot(
      providerClient.provider,
      providerClient.streamRun({
        runId: run.runId,
        sessionId: run.sessionId,
        signal: options.signal,
        include: { rawEvents: true },
      }),
      run.sessionId,
      run,
      options,
    );
    return options.signal?.aborted ? cancelProviderRun() : snapshot;
  } catch (error) {
    if (!isTransientProviderError(error)) throw error;
    await delay(PROVIDER_RETRY_BACKOFF_MS);

    try {
      const snapshot = await collectProviderRunSnapshot(
        providerClient.provider,
        providerClient.streamRun({
          runId: run.runId,
          sessionId: run.sessionId,
          signal: options.signal,
          include: { rawEvents: true },
        }),
        run.sessionId,
        run,
        options,
      );
      return options.signal?.aborted ? cancelProviderRun() : snapshot;
    } catch (resumeError) {
      if (!isTransientProviderError(resumeError)) throw resumeError;
    }

    // Reconnect failed. Rather than assume the run failed, poll the
    // authoritative run state. The run may still be executing on the provider
    // (keep it Running for the recovery worker) or may have already finished
    // while our stream was severed (finalize from the snapshot).
    return reconcileInterruptedRun(providerClient, run, options.signal);
  }
}

async function reconcileInterruptedRun(
  providerClient: NonNullable<Awaited<ReturnType<typeof requireAiClient>>["providerClient"]>,
  run: ProviderRunRef,
  signal?: AbortSignal,
): Promise<ProviderRunSnapshot> {
  try {
    return await providerClient.getRun({
      runId: run.runId,
      sessionId: run.sessionId,
      signal,
    });
  } catch {
    // getRun is unavailable (network error, transient 404 before the run is
    // queryable). Keep the run in a non-terminal state so the restart-recovery
    // worker reconciles it later instead of recording a false failure here.
    return {
      provider: providerClient.provider,
      runId: run.runId,
      nativeRunId: run.nativeRunId,
      sessionId: run.sessionId,
      status: "running",
      error: null,
    };
  }
}

async function ensureProviderRunRecord(input: {
  workspaceId: string;
  taskId: string;
  nodeAttempt?: NodeAttempt;
  nodeAttemptId?: string;
  providerRunIdempotencyKey?: string;
}) {
  if (!input.nodeAttempt || !input.providerRunIdempotencyKey) return null;

  const planRun = await db.taskPlanRun.findFirst({
    where: {
      taskId: input.taskId,
      planId: input.nodeAttempt.graphId,
    },
    select: { id: true, executionEpoch: true },
  });
  if (!planRun) return null;

  const nodeAttempt = await db.taskPlanNodeAttempt.upsert({
    where: { idempotencyKey: input.nodeAttempt.idempotencyKey },
    update: {
      status: input.nodeAttempt.status,
      runtimeSnapshot: toJsonInput(input.nodeAttempt.runtimeSnapshot),
      finishedAt: input.nodeAttempt.finishedAt
        ? new Date(input.nodeAttempt.finishedAt)
        : null,
      error: toJsonInput(input.nodeAttempt.error),
    },
    create: {
      id: input.nodeAttempt.id,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.nodeAttempt.graphId,
      planRunId: planRun.id,
      nodeId: input.nodeAttempt.nodeId,
      nodeLayerId: input.nodeAttempt.nodeLayerId,
      executionContextSnapshotId: input.nodeAttempt.executionContextSnapshotId,
      idempotencyKey: input.nodeAttempt.idempotencyKey,
      attemptNumber: input.nodeAttempt.attemptNumber,
      status: input.nodeAttempt.status,
      executionEpoch: planRun.executionEpoch,
      startedAt: new Date(input.nodeAttempt.startedAt),
      finishedAt: input.nodeAttempt.finishedAt
        ? new Date(input.nodeAttempt.finishedAt)
        : null,
      error: toJsonInput(input.nodeAttempt.error),
      runtimeSnapshot: toJsonInput(input.nodeAttempt.runtimeSnapshot),
    },
    select: { id: true },
  });

  return db.taskPlanProviderRun.upsert({
    where: { idempotencyKey: input.providerRunIdempotencyKey },
    update: { status: "running" },
    create: {
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      planId: input.nodeAttempt.graphId,
      planRunId: planRun.id,
      nodeAttemptId: nodeAttempt.id,
      idempotencyKey: input.providerRunIdempotencyKey,
      status: "running",
    },
    select: { id: true, planRunId: true, nodeAttemptId: true },
  });
}

function toJsonInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function updateProviderRunRecord(
  providerRunRecordId: string | undefined,
  data: {
    providerRunRef?: string | null;
    runtimeName?: string | null;
    nativeRunId?: string | null;
    firstRawEventId?: string | null;
    lastRawEventId?: string | null;
    completedByEventId?: string | null;
    failedByEventId?: string | null;
    correlationId?: string | null;
    status: string;
    finishedAt?: Date | null;
  },
) {
  if (!providerRunRecordId) return;
  await db.taskPlanProviderRun.update({
    where: { id: providerRunRecordId },
    data,
  });
}

async function persistRuntimeRunRef(
  runId: string | undefined,
  run: ProviderRunRef,
) {
  if (!runId) return;
  const runtimeSessionRef = requireRuntimeSessionId(run.sessionId, "provider run ref");
  const runtimeRunRef = await uniqueRuntimeRunRef(runId, run.nativeRunId ?? run.runId);
  await db.run.update({
    where: { id: runId },
    data: {
      runtimeRunRef,
      runtimeSessionRef,
      status: RunStatus.Running,
      syncStatus: "healthy",
    },
  });
}

async function uniqueRuntimeRunRef(runId: string, providerRunRef: string | null) {
  if (!providerRunRef) return null;
  const existing = await db.run.findUnique({
    where: { runtimeRunRef: providerRunRef },
    select: { id: true },
  });
  if (!existing || existing.id === runId) return providerRunRef;
  return `${providerRunRef}:${runId}`;
}

async function readTaskSessionProviderRef(
  taskSessionId: string | undefined,
): Promise<string | undefined> {
  if (!taskSessionId) return undefined;
  const session = await db.taskSession.findUnique({
    where: { id: taskSessionId },
    select: { providerSessionRef: true },
  });
  return session?.providerSessionRef?.trim() || undefined;
}

async function persistTaskSessionProviderRef(
  taskSessionId: string | undefined,
  providerSessionRef: string,
): Promise<void> {
  if (!taskSessionId) return;
  await db.taskSession.update({
    where: { id: taskSessionId },
    data: { providerSessionRef },
  });
}

function requireRuntimeSessionId(value: string | undefined, source: string) {
  const sessionId = value?.trim();
  if (!sessionId || sessionId === "unknown") {
    throw new Error(`Runtime ${source} missing sessionId`);
  }
  return sessionId;
}

function isTransientProviderError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; status?: unknown; retryable?: unknown };
  if (record.retryable === true) return true;
  if (typeof record.status === "number" && (record.status === 429 || record.status >= 500)) {
    return true;
  }
  return typeof record.code === "string" && TRANSIENT_PROVIDER_ERROR_CODES.has(record.code);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectProviderRunSnapshot(
  provider: string,
  events: AsyncIterable<ProviderRunEvent>,
  fallbackSessionId: string,
  fallbackRun?: { runId: string; nativeRunId?: string; sessionId?: string },
  options: {
    onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
    eventPersistence?: RuntimeEventPersistenceContext;
    terminalToolName?: string;
  } = {},
): Promise<ProviderRunSnapshot> {
  let snapshot: ProviderRunSnapshot | null = null;
  let eventIndex = 0;
  let terminalToolName: string | undefined = options.terminalToolName;
  for await (const event of events) {
    eventIndex += 1;
    await options.onRuntimeEvent?.(event);
    await persistProviderRuntimeEvent({
      context: options.eventPersistence,
      event,
      fallbackIndex: eventIndex,
    });
    if (event.type === "run_completed") {
      const sessionId = requireRuntimeSessionId(
        event.run.sessionId,
        "completed event",
      );
      snapshot = {
        provider,
        runId: event.run.runId,
        nativeRunId: event.run.nativeRunId,
        sessionId,
        status: event.run.status ?? "completed",
        outputText: event.outputText,
        structuredPayload: event.structuredPayload,
        usage: event.usage,
        error: null,
        raw: event.raw === undefined && terminalToolName === undefined
          ? undefined
          : { raw: event.raw, terminalToolName },
      };
    }
    if (event.type === "tool_completed") {
      terminalToolName = event.toolName ?? terminalToolName;
    }
    if (event.type === "run_failed") {
      const run = event.run ?? fallbackRun;
      snapshot = {
        provider,
        runId: run?.runId ?? crypto.randomUUID(),
        nativeRunId: run?.nativeRunId,
        sessionId: run?.sessionId ?? fallbackSessionId,
        status: "failed",
        error: event.error,
        raw: event.raw,
      };
    }
  }
  if (!snapshot) {
    throw new IncompleteRunStreamError();
  }
  return snapshot;
}

type RuntimeEventPersistenceContext = {
  workspaceId: string;
  taskId: string;
  workBlockId?: string | null;
  runId: string;
  taskSessionId?: string | null;
  planId?: string | null;
  planRunId?: string | null;
  nodeAttemptId?: string | null;
  providerRunId?: string | null;
  runtimeName: string;
  nodeContext?: {
    nodeId: string;
    nodeTitle: string;
  };
};

async function persistProviderRuntimeEvent(input: {
  context?: RuntimeEventPersistenceContext;
  event: ProviderRunEvent;
  fallbackIndex: number;
}) {
  const context = input.context;
  if (!context) return;

  try {
    const occurredAt = typeof input.event.timestamp === "string"
      ? new Date(input.event.timestamp)
      : new Date();
    const sequence = input.event.sequence ?? input.fallbackIndex;
    const eventTime = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    const rawEvent = await appendRawEventLog({
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      runId: context.runId,
      taskSessionId: context.taskSessionId ?? null,
      planId: context.planId ?? null,
      nodeAttemptId: context.nodeAttemptId ?? null,
      providerRunId: context.providerRunId ?? null,
      nodeId: context.nodeContext?.nodeId ?? null,
      nodeTitle: context.nodeContext?.nodeTitle ?? null,
      source: "provider",
      direction: "inbound",
      rawType: input.event.rawEventType ?? input.event.type,
      provider: input.event.provider,
      runtimeName: context.runtimeName,
      rawPayload: rawPayloadForProviderEvent(input.event),
      metadata: hasRawProviderPayload(input.event)
        ? { normalizedEvent: input.event }
        : null,
      nativeRunId: input.event.nativeRunId ?? input.event.runId,
      externalRef: `provider.runtime:${context.runId}:${sequence}:${input.event.type}:${input.event.rawEventType ?? "event"}`,
      sequence,
      correlationId: context.providerRunId ?? context.runId,
      occurredAt: eventTime,
    });

    const event = await appendCanonicalEvent({
      eventType: `provider.${input.event.type}`,
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      workBlockId: context.workBlockId,
      runId: context.runId,
      taskSessionId: context.taskSessionId ?? null,
      planId: context.planId ?? null,
      nodeAttemptId: context.nodeAttemptId ?? null,
      providerRunId: context.providerRunId ?? null,
      nodeId: context.nodeContext?.nodeId ?? null,
      nodeTitle: context.nodeContext?.nodeTitle ?? null,
      rawEventId: rawEvent.id,
      correlationId: context.providerRunId ?? context.runId,
      actorType: "runtime",
      actorId: context.runtimeName,
      source: "provider",
      payload: {
        runtimeName: context.runtimeName,
        provider: input.event.provider,
        runId: input.event.runId,
        nativeRunId: input.event.nativeRunId,
        sequence,
        rawEventType: input.event.rawEventType,
        event: input.event,
      },
      summary: summaryForProviderEvent(input.event),
      dedupeKey: `provider.runtime:${context.runId}:${sequence}:${input.event.type}:${input.event.rawEventType ?? "event"}`,
      occurredAt: eventTime,
    });
    await db.task.update({
      where: { id: context.taskId },
      data: { latestEventId: event.id, latestRawEventId: rawEvent.id },
    }).catch(() => undefined);
    await updateProviderRunAuditRefs({
      providerRunRecordId: context.providerRunId,
      rawEventId: rawEvent.id,
      eventId: event.id,
      eventType: input.event.type,
      nativeRunId: input.event.nativeRunId ?? input.event.runId ?? null,
      runtimeName: context.runtimeName,
      correlationId: context.providerRunId ?? context.runId,
    });
    if (input.event.type === "approval_required") {
      await persistProviderApproval({
        context,
        providerRunId: context.providerRunId,
        rawEventId: rawEvent.id,
        eventId: event.id,
        event: input.event,
        requestedAt: eventTime,
      });
    } else {
      await reconcilePendingProviderApprovals({
        providerRunId: context.providerRunId,
        event: input.event,
        observedAt: eventTime,
      });
    }
  } catch {
    // Runtime event persistence must not interrupt provider streaming.
  }
}

const HERMES_DEFAULT_APPROVAL_TIMEOUT_MS = 60_000;

async function reconcilePendingProviderApprovals(input: {
  providerRunId?: string | null;
  event: ProviderRunEvent;
  observedAt: Date;
}) {
  if (!input.providerRunId) return;

  const pendingApprovals = await db.taskPlanProviderApproval.findMany({
    where: {
      providerRunId: input.providerRunId,
      status: "pending",
    },
    select: {
      id: true,
      requestedAt: true,
    },
  });
  if (pendingApprovals.length === 0) return;

  const isTerminalEvent =
    input.event.type === "run_completed" ||
    input.event.type === "run_failed" ||
    input.event.type === "run_cancelled";
  const expiredApprovalIds = pendingApprovals
    .filter((approval) =>
      isTerminalEvent || input.observedAt.getTime() - approval.requestedAt.getTime() >= HERMES_DEFAULT_APPROVAL_TIMEOUT_MS,
    )
    .map((approval) => approval.id);
  if (expiredApprovalIds.length === 0) return;

  await db.taskPlanProviderApproval.updateMany({
    where: {
      id: { in: expiredApprovalIds },
      status: "pending",
    },
    data: {
      status: "superseded",
      resolvedAt: input.observedAt,
      resolvedBy: "provider",
      resolutionRaw: toJsonInput({
        resolution_source: "provider_reconciliation",
        reason: isTerminalEvent
          ? "provider_run_ended_without_chrona_resolution"
          : "provider_continued_after_default_approval_timeout",
        inferred_result: "default_denied",
        timeoutMs: HERMES_DEFAULT_APPROVAL_TIMEOUT_MS,
        observed_event_type: input.event.type,
        observed_status: "run" in input.event ? input.event.run?.status : undefined,
        nativeRunId: input.event.nativeRunId ?? input.event.runId,
      }),
    },
  });
}

async function persistProviderApproval(input: {
  context: RuntimeEventPersistenceContext;
  providerRunId?: string | null;
  rawEventId: string;
  eventId: string;
  event: Extract<ProviderRunEvent, { type: "approval_required" }>;
  requestedAt: Date;
}) {
  if (!input.providerRunId || !input.context.planId || !input.context.planRunId) {
    return;
  }
  const approval = input.event.approval;
  const approvalRef = approval.id ?? `${input.event.sequence ?? 0}:${approval.providerKind ?? approval.kind}`;
  await db.taskPlanProviderApproval.upsert({
    where: {
      providerRunId_approvalRef: {
        providerRunId: input.providerRunId,
        approvalRef,
      },
    },
    update: {
      rawEventId: input.rawEventId,
      responseEventId: input.eventId,
      rawPayload: toJsonInput(approval.raw),
      requestedAt: input.requestedAt,
      updatedAt: new Date(),
    },
    create: {
      workspaceId: input.context.workspaceId,
      taskId: input.context.taskId,
      workBlockId: input.context.workBlockId ?? null,
      planId: input.context.planId,
      planRunId: input.context.planRunId,
      nodeAttemptId: input.context.nodeAttemptId ?? null,
      providerRunId: input.providerRunId,
      nodeId: input.context.nodeContext?.nodeId ?? null,
      nodeTitle: input.context.nodeContext?.nodeTitle ?? null,
      provider: approval.provider,
      runtimeName: input.context.runtimeName,
      nativeRunId: approval.nativeRunId ?? approval.runId,
      approvalRef,
      kind: approval.kind,
      providerKind: approval.providerKind,
      title: approval.title,
      summary: approval.summary,
      description: approval.description,
      riskLevel: approval.riskLevel,
      subject: toJsonInput(approval.subject),
      choices: toJsonInput(approval.choices) as Prisma.InputJsonValue,
      scopePolicy: toJsonInput(approval.scopePolicy),
      rawPayload: toJsonInput(approval.raw),
      status: "pending",
      requestedAt: input.requestedAt,
      rawEventId: input.rawEventId,
      responseEventId: input.eventId,
    },
  });
}

async function updateProviderRunAuditRefs(input: {
  providerRunRecordId?: string | null;
  rawEventId: string;
  eventId: string;
  eventType: string;
  nativeRunId?: string | null;
  runtimeName: string;
  correlationId: string;
}) {
  if (!input.providerRunRecordId) return;
  const existing = await db.taskPlanProviderRun.findUnique({
    where: { id: input.providerRunRecordId },
    select: { firstRawEventId: true },
  });
  await db.taskPlanProviderRun.update({
    where: { id: input.providerRunRecordId },
    data: {
      runtimeName: input.runtimeName,
      nativeRunId: input.nativeRunId ?? undefined,
      firstRawEventId: existing?.firstRawEventId ?? input.rawEventId,
      lastRawEventId: input.rawEventId,
      completedByEventId: input.eventType === "run_completed" ? input.eventId : undefined,
      failedByEventId: input.eventType === "run_failed" ? input.eventId : undefined,
      status: input.eventType === "approval_required" ? "waiting_for_approval" : undefined,
      correlationId: input.correlationId,
    },
  });
}

function summaryForProviderEvent(event: ProviderRunEvent) {
  if (event.type === "tool_started" || event.type === "tool_completed") {
    const toolName = "toolName" in event ? event.toolName : undefined;
    return typeof toolName === "string" ? toolName : event.type;
  }
  if (event.type === "run_failed") return event.error;
  return event.type;
}

function hasRawProviderPayload(event: ProviderRunEvent): event is ProviderRunEvent & { raw: unknown } {
  return "raw" in event && event.raw !== undefined;
}

function rawPayloadForProviderEvent(event: ProviderRunEvent) {
  return hasRawProviderPayload(event) ? event.raw : event;
}

function buildExecutionGatewayRequest(input: {
  instructions: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
  sessionKey: string;
  sessionId: string;
  executionRuntime: string;
  resumeSessionRef?: string;
}): ExecutionProviderRequest {
  const aiInput = buildExecutionAiInput({
    executionRuntime: input.executionRuntime,
    runtimeInput: input.runtimeInput,
    featureSpec: input.featureSpec,
  });
  const parts: string[] = [];
  parts.push(`Execution runtime: ${input.executionRuntime}`);
  if (Object.keys(input.runtimeInput).length > 0) {
    parts.push(
      `Runtime input JSON:\n${JSON.stringify(input.runtimeInput, null, 2)}`,
    );
  }
  parts.push(input.instructions);

  const maxTokens =
    input.runtimeInput.maxTokens ?? input.runtimeInput.maxOutputTokens;

  return {
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    instructions: input.featureSpec.instructions ?? parts.join("\n\n"),
    input: aiInput,
    structuredOutputSchema: input.featureSpec.structuredOutputSchema,
    terminalToolName: input.featureSpec.terminalToolName,
    maxOutputTokens: typeof maxTokens === "number" ? maxTokens : undefined,
    ...(input.resumeSessionRef
      ? { resumeSessionRef: input.resumeSessionRef }
      : {}),
  };
}

function buildExecutionAiInput(input: {
  executionRuntime: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
}): string | Record<string, unknown> {
  const runtimeInput = input.runtimeInput;

  switch (input.featureSpec.feature) {
    case "execute_task_node":
    case "evaluate_condition_node":
    case "review_checkpoint_node":
      return runtimeInput;
    case "suggest":
    case "generate_plan":
      return {
        executionRuntime: input.executionRuntime,
        runtimeInput,
      };
    default:
      return {
        executionRuntime: input.executionRuntime,
        runtimeInput,
      };
  }
}

async function persistRuntimeHistory(input: {
  runId: string;
  request: ExecutionProviderRequest;
  response: ProviderRunSnapshot;
}): Promise<string[]> {
  try {
    const assistantContent = extractAssistantContent(input.response);
    const history: ProviderChatHistory = {
      messages: [
        { role: "user", content: extractUserText(input.request) },
        ...(assistantContent
          ? [{ role: "assistant", content: assistantContent }]
          : []),
      ],
    };
    const conversationEntryIds: string[] = [];

    for (let index = 0; index < history.messages.length; index += 1) {
      const message = history.messages[index];
      if (
        typeof message?.role !== "string" ||
        typeof message?.content !== "string" ||
        message.content.length === 0
      ) {
        continue;
      }

      const created = await db.conversationEntry.create({
        data: {
          runId: input.runId,
          role: message.role,
          content: message.content,
          sequence: index + 1,
          runtimeTs: new Date(),
        },
        select: { id: true },
      });
      conversationEntryIds.push(created.id);
    }

    return conversationEntryIds;
  } catch {
    return [];
  }
}

function extractAssistantContent(response: ProviderRunSnapshot): string | null {
  const output = (response.outputText ?? "").trim();
  if (output) return output;

  const structured = response.structuredPayload;
  const parsed = structured && typeof structured === "object" && "ok" in structured && structured.ok
    ? (structured as { parsed?: unknown }).parsed
    : null;
  if (!parsed) return null;
  if (typeof parsed === "string") return parsed.trim() || null;
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (typeof record.output === "string" && record.output.trim()) {
    return record.output.trim();
  }
  if (typeof record.summary === "string" && record.summary.trim()) {
    return record.summary.trim();
  }

  return JSON.stringify(record);
}

function extractUserText(request: ExecutionProviderRequest): string {
  const segments = [request.instructions];
  try {
    segments.push(JSON.stringify(request.input, null, 2));
  } catch {
    segments.push(String(request.input));
  }
  return segments.filter(Boolean).join("\n\n");
}

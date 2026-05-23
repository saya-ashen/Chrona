import { RunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { appendCanonicalEvent } from "@/modules/events/append-canonical-event";
import type { PreparedAiFeatureSpec } from "@chrona/contracts/ai";
import type {
  ProviderRunEvent,
  ProviderRunSnapshot,
  ProviderRunInput,
  ProviderRunRef,
  StartRunInput,
} from "@chrona/providers-foundation";
import { requireAiClient } from "../ai/runtime/client-resolution";

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
};

export type AiRuntimeInvocationInput = {
  taskId: string;
  taskSessionId: string;
  runtimeName: string;
  runtimeSessionKey: string;
  runtimeInput: Record<string, unknown>;
  instructions: string;
  featureSpec: PreparedAiFeatureSpec;
  triggeredBy: "system" | "user";
  clientId?: string | null;
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
};

export type AiRuntimeInvocation = {
  runId: string;
  runtimeRunRef: string | null;
  runtimeSessionKey: string;
  conversationEntryIds: string[];
  response: ProviderRunSnapshot;
};

const TRANSIENT_PROVIDER_ERROR_CODES = new Set([
  "aborted",
  "network_error",
  "provider_error",
  "rate_limited",
]);

const PROVIDER_RETRY_BACKOFF_MS = 1_000;

export class AiRuntimeInvoker {
  async invoke(input: AiRuntimeInvocationInput): Promise<AiRuntimeInvocation> {
    const task = await db.task.findUniqueOrThrow({
      where: { id: input.taskId },
      select: { workspaceId: true },
    });
    const run = await db.run.create({
      data: {
        taskId: input.taskId,
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

      const request = buildExecutionGatewayRequest({
        instructions: input.instructions,
        runtimeInput: input.runtimeInput,
        featureSpec: input.featureSpec,
        sessionKey: input.runtimeSessionKey,
        sessionId: input.runtimeSessionKey,
        executionRuntime: input.runtimeName,
      });
      const response = await runProviderRequest(client.providerClient, request, {
        runId: run.id,
        onRuntimeEvent: input.onRuntimeEvent,
        eventPersistence: {
          workspaceId: task.workspaceId,
          taskId: input.taskId,
          runId: run.id,
          runtimeName: input.runtimeName,
        },
      });
      const runtimeSessionKey = response.sessionId || input.runtimeSessionKey;
      const runtimeRunRef = response.nativeRunId ?? response.runId ?? null;
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

      return {
        runId: run.id,
        runtimeRunRef,
        runtimeSessionKey,
        conversationEntryIds,
        response,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db.run.update({
        where: { id: run.id },
        data: { status: RunStatus.Failed, errorSummary: message },
      });
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
    timeoutMs: request.timeoutSeconds
      ? request.timeoutSeconds * 1000
      : undefined,
    stream: true,
  };
}

async function runProviderRequest(
  providerClient: NonNullable<Awaited<ReturnType<typeof requireAiClient>>["providerClient"]>,
  request: ExecutionProviderRequest,
  options: {
    runId?: string;
    onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
    eventPersistence?: RuntimeEventPersistenceContext;
  } = {},
): Promise<ProviderRunSnapshot> {
  const startInput = toStartRunInput(request);
  const idempotencyKey = options.runId
    ? `chrona-runtime:${options.runId}`
    : undefined;
  let run = await providerClient.startRun({
    ...startInput,
    idempotencyKey,
  } as StartRunInput & { idempotencyKey?: string });
  await persistRuntimeRunRef(options.runId, run);

  try {
    return await collectProviderRunSnapshot(
      providerClient.provider,
      providerClient.streamRun({ runId: run.runId }),
      run.sessionId,
      run,
      options,
    );
  } catch (error) {
    if (!isTransientProviderError(error)) throw error;
    await delay(PROVIDER_RETRY_BACKOFF_MS);

    try {
      return await collectProviderRunSnapshot(
        providerClient.provider,
        providerClient.streamRun({ runId: run.runId }),
        run.sessionId,
        run,
        options,
      );
    } catch (resumeError) {
      if (!isTransientProviderError(resumeError)) throw resumeError;
    }

    run = await providerClient.startRun({
      ...startInput,
      idempotencyKey,
    } as StartRunInput & { idempotencyKey?: string });
    await persistRuntimeRunRef(options.runId, run);
    return collectProviderRunSnapshot(
      providerClient.provider,
      providerClient.streamRun({ runId: run.runId }),
      run.sessionId,
      run,
      options,
    );
  }
}

async function persistRuntimeRunRef(
  runId: string | undefined,
  run: ProviderRunRef,
) {
  if (!runId) return;
  await db.run.update({
    where: { id: runId },
    data: {
      runtimeRunRef: run.nativeRunId ?? run.runId,
      runtimeSessionRef: run.sessionId,
      status: RunStatus.Running,
      syncStatus: "healthy",
    },
  });
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
  } = {},
): Promise<ProviderRunSnapshot> {
  let snapshot: ProviderRunSnapshot | null = null;
  let eventIndex = 0;
  for await (const event of events) {
    eventIndex += 1;
    await options.onRuntimeEvent?.(event);
    await persistProviderRuntimeEvent({
      context: options.eventPersistence,
      event,
      fallbackIndex: eventIndex,
    });
    if (event.type === "run_completed") {
      snapshot = {
        provider,
        runId: event.run.runId,
        nativeRunId: event.run.nativeRunId,
        sessionId: event.run.sessionId,
        status: event.run.status ?? "completed",
        outputText: event.outputText,
        structuredPayload: event.structuredPayload,
        usage: event.usage,
        error: null,
        raw: event.raw,
      };
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
    throw new Error("Provider run finished without a snapshot");
  }
  return snapshot;
}

type RuntimeEventPersistenceContext = {
  workspaceId: string;
  taskId: string;
  runId: string;
  runtimeName: string;
};

async function persistProviderRuntimeEvent(input: {
  context?: RuntimeEventPersistenceContext;
  event: ProviderRunEvent;
  fallbackIndex: number;
}) {
  const context = input.context;
  if (!context) return;

  try {
    const runtimeTs = typeof input.event.timestamp === "string"
      ? new Date(input.event.timestamp)
      : new Date();
    const sequence = input.event.sequence ?? input.fallbackIndex;

    await appendCanonicalEvent({
      eventType: `provider.${input.event.type}`,
      workspaceId: context.workspaceId,
      taskId: context.taskId,
      runId: context.runId,
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
      dedupeKey: `provider.runtime:${context.runId}:${sequence}:${input.event.type}:${input.event.rawEventType ?? "event"}`,
      runtimeTs: Number.isNaN(runtimeTs.getTime()) ? new Date() : runtimeTs,
    });
  } catch {
    // Runtime event persistence must not interrupt provider streaming.
  }
}

function buildExecutionGatewayRequest(input: {
  instructions: string;
  runtimeInput: Record<string, unknown>;
  featureSpec: PreparedAiFeatureSpec;
  sessionKey: string;
  sessionId: string;
  executionRuntime: string;
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

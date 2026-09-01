import { createProviderStreamEventBoundary, type ProviderStreamEventBoundary } from "@/modules/ai";
import type { ProviderRunEvent, ProviderRunSnapshot } from "@chrona/providers-foundation";
import { persistProviderRuntimeEvent, type RuntimeEventPersistenceContext } from "./ai-runtime-event-persistence";
import { requireRuntimeSessionId } from "./ai-runtime-persistence";

export class IncompleteRunStreamError extends Error {
  readonly code = "incomplete_stream";
  readonly retryable = true;

  constructor() {
    super("Provider run stream ended without a terminal event");
    this.name = "IncompleteRunStreamError";
  }
}

type SnapshotContext = {
  provider: string;
  fallbackSessionId: string;
  fallbackRun?: { runId: string; nativeRunId?: string; sessionId?: string; nativeSessionId?: string };
  terminalToolName?: string;
};

type ProviderRunCollectionOptions = {
  onRuntimeEvent?: (event: ProviderRunEvent) => Promise<void> | void;
  eventPersistence?: RuntimeEventPersistenceContext;
  terminalToolName?: string;
  signal?: AbortSignal;
};

type ProviderRunCollection = {
  snapshot: ProviderRunSnapshot | null;
  terminalToolCall?: Extract<ProviderRunEvent, { type: "tool_call" }>;
};

export async function collectProviderRunSnapshot(
  provider: string,
  events: AsyncIterable<ProviderRunEvent>,
  fallbackSessionId: string,
  fallbackRun?: { runId: string; nativeRunId?: string; sessionId?: string; nativeSessionId?: string },
  options: ProviderRunCollectionOptions = {},
): Promise<ProviderRunSnapshot> {
  const boundary = createProviderStreamEventBoundary({
    provider,
    runId: fallbackRun?.runId ?? "",
    sessionId: fallbackRun?.sessionId ?? fallbackSessionId,
  });
  const context = { provider, fallbackSessionId, fallbackRun };
  const collection: ProviderRunCollection = { snapshot: null };
  try {
    await consumeProviderEvents(events, boundary, context, options, collection);
  } catch (error) {
    const recorded = await recordedSnapshotAfterTerminalAction(
      context,
      options,
      collection.terminalToolCall,
    );
    if (recorded) return recorded;
    throw error;
  }
  const recorded = await recordedSnapshotAfterTerminalAction(
    context,
    options,
    collection.terminalToolCall,
  );
  if (recorded) return recorded;
  finishProviderEventBoundary(boundary);
  if (!collection.snapshot) throw new IncompleteRunStreamError();
  return collection.snapshot;
}

async function consumeProviderEvents(
  events: AsyncIterable<ProviderRunEvent>,
  boundary: ProviderStreamEventBoundary,
  context: SnapshotContext,
  options: ProviderRunCollectionOptions,
  collection: ProviderRunCollection,
): Promise<void> {
  let terminalToolName: string | undefined;
  let eventIndex = 0;
  for await (const value of events) {
    const event = boundary.accept(value);
    eventIndex += 1;
    await options.onRuntimeEvent?.(event);
    await persistProviderRuntimeEvent({ context: options.eventPersistence, event, fallbackIndex: eventIndex });
    collection.snapshot = snapshotForProviderEvent(event, { ...context, terminalToolName }) ?? collection.snapshot;
    terminalToolName = terminalToolForEvent(event, terminalToolName);
    if (event.type === "tool_call" && event.tool === options.terminalToolName) {
      collection.terminalToolCall = event;
    }
  }
}

async function recordedSnapshotAfterTerminalAction(
  context: SnapshotContext,
  options: ProviderRunCollectionOptions,
  terminalToolCall?: ProviderRunCollection["terminalToolCall"],
): Promise<ProviderRunSnapshot | null> {
  if (terminalToolCall && options.signal && !options.signal.aborted) {
    await waitForTerminalAction(options.signal);
  }
  return recordedTerminalActionSnapshot({ ...context, signal: options.signal, terminalToolCall });
}

async function waitForTerminalAction(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await Promise.race([
    new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 250)),
  ]);
}

function recordedTerminalActionSnapshot(input: {
  provider: string;
  fallbackSessionId: string;
  fallbackRun?: { runId: string; nativeRunId?: string; sessionId?: string; nativeSessionId?: string };
  signal?: AbortSignal;
  terminalToolCall?: Extract<ProviderRunEvent, { type: "tool_call" }>;
}): ProviderRunSnapshot | null {
  if (
    !input.signal?.aborted ||
    input.signal.reason !== "Chrona terminal action recorded" ||
    !input.terminalToolCall
  ) return null;
  const summary = input.terminalToolCall.input.summary;
  return {
    provider: input.provider,
    runId: input.fallbackRun?.runId ?? crypto.randomUUID(),
    nativeRunId: input.fallbackRun?.nativeRunId,
    sessionId: input.fallbackRun?.sessionId ?? input.fallbackSessionId,
    nativeSessionId: input.fallbackRun?.nativeSessionId,
    status: "completed",
    ...(typeof summary === "string" ? { outputText: summary } : {}),
    error: null,
    raw: {
      terminalActionRecorded: true,
      terminalTool: {
        name: input.terminalToolCall.tool,
        callId: input.terminalToolCall.callId,
        input: input.terminalToolCall.input,
      },
    },
  };
}

function finishProviderEventBoundary(boundary: ProviderStreamEventBoundary) {
  try {
    boundary.finish();
  } catch (error) {
    if (error instanceof Error && error.message === "Provider stream ended without exactly one terminal event") {
      throw new IncompleteRunStreamError();
    }
    throw error;
  }
}

function snapshotForProviderEvent(event: ProviderRunEvent, context: SnapshotContext): ProviderRunSnapshot | null {
  if (event.type === "run_completed") return completedSnapshot(event, context);
  if (event.type === "run_failed") return terminalSnapshot(event, context, "failed", event.error);
  if (event.type === "run_cancelled") return terminalSnapshot(event, context, "cancelled", null);
  return null;
}

function completedSnapshot(event: Extract<ProviderRunEvent, { type: "run_completed" }>, context: SnapshotContext): ProviderRunSnapshot {
  const terminalToolName = event.terminalToolCall?.name ?? context.terminalToolName;
  const raw = event.raw === undefined && terminalToolName === undefined
    ? undefined
    : {
        ...(event.raw === undefined ? {} : { raw: event.raw }),
        ...(event.terminalToolCall
          ? { terminalTool: event.terminalToolCall }
          : terminalToolName
            ? { terminalToolName }
            : {}),
      };
  return {
    provider: context.provider,
    runId: event.run.runId,
    nativeRunId: event.run.nativeRunId,
    sessionId: requireRuntimeSessionId(event.run.sessionId, "completed event"),
    nativeSessionId: event.run.nativeSessionId,
    status: "completed",
    outputText: event.outputText,
    structuredPayload: event.structuredPayload,
    usage: event.usage,
    error: null,
    raw,
  };
}

function terminalSnapshot(
  event: Extract<ProviderRunEvent, { type: "run_failed" | "run_cancelled" }>,
  context: SnapshotContext,
  status: "failed" | "cancelled",
  error: string | null,
): ProviderRunSnapshot {
  const run = event.run ?? context.fallbackRun;
  return {
    provider: context.provider,
    runId: run?.runId ?? crypto.randomUUID(),
    nativeRunId: run?.nativeRunId,
    sessionId: run?.sessionId ?? context.fallbackSessionId,
    nativeSessionId: run?.nativeSessionId,
    status,
    error,
    raw: event.raw,
  };
}

function terminalToolForEvent(event: ProviderRunEvent, current: string | undefined): string | undefined {
  if (event.type === "tool_call") return event.tool;
  return event.type === "tool_completed" ? event.toolName ?? current : current;
}

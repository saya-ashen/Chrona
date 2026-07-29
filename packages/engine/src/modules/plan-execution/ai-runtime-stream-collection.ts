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
  fallbackRun?: { runId: string; nativeRunId?: string; sessionId?: string };
  terminalToolName?: string;
};

export async function collectProviderRunSnapshot(
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
  const boundary = createProviderStreamEventBoundary({
    provider,
    runId: fallbackRun?.runId ?? "",
    sessionId: fallbackRun?.sessionId ?? fallbackSessionId,
  });
  let snapshot: ProviderRunSnapshot | null = null;
  let terminalToolName: string | undefined;
  let eventIndex = 0;
  for await (const value of events) {
    const event = boundary.accept(value);
    eventIndex += 1;
    await options.onRuntimeEvent?.(event);
    await persistProviderRuntimeEvent({ context: options.eventPersistence, event, fallbackIndex: eventIndex });
    snapshot = snapshotForProviderEvent(event, { provider, fallbackSessionId, fallbackRun, terminalToolName }) ?? snapshot;
    terminalToolName = terminalToolForEvent(event, terminalToolName);
  }
  finishProviderEventBoundary(boundary);
  if (!snapshot) throw new IncompleteRunStreamError();
  return snapshot;
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
  return {
    provider: context.provider,
    runId: event.run.runId,
    nativeRunId: event.run.nativeRunId,
    sessionId: requireRuntimeSessionId(event.run.sessionId, "completed event"),
    status: "completed",
    outputText: event.outputText,
    structuredPayload: event.structuredPayload,
    usage: event.usage,
    error: null,
    raw: event.raw === undefined && context.terminalToolName === undefined ? undefined : { raw: event.raw, terminalToolName: context.terminalToolName },
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
    status,
    error,
    raw: event.raw,
  };
}

function terminalToolForEvent(event: ProviderRunEvent, current: string | undefined): string | undefined {
  if (event.type === "tool_call") return event.tool;
  return event.type === "tool_completed" ? event.toolName ?? current : current;
}

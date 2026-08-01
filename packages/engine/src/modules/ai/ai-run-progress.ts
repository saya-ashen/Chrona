import {
  providerRunEventSchema,
  type ProviderRunEvent,
} from "@chrona/providers-foundation";
import {
  aiRunProgressEventSchema,
  aiRunProgressOperationParamSchema,
  type AiRunProgressEvent,
  type AiRunProgressPhase,
} from "@chrona/contracts";

const TERMINAL_RETENTION_MS = 5 * 60 * 1000;
const MAX_SESSION_RETENTION_MS = 60 * 60 * 1000;
const MAX_SAFE_ERROR_LENGTH = 240;

type NonTerminalPhase = Exclude<AiRunProgressPhase, "completed" | "failed">;
type ProgressListener = (event: AiRunProgressEvent) => void;

type AiRunProgressSession = {
  operationId: string;
  feature: string;
  events: AiRunProgressEvent[];
  listeners: Set<ProgressListener>;
  terminal: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

export type AiRunProgressReporter = {
  observeProviderEvent(event: ProviderRunEvent): void;
  emitPhase(phase: NonTerminalPhase): void;
  complete(): void;
  fail(error: unknown): void;
};

export type AiRunProgressSubscription = {
  unsubscribe(): void;
};

const sessions = new Map<string, AiRunProgressSession>();

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "AI run failed.";
  const normalized = message.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || "AI run failed.").slice(0, MAX_SAFE_ERROR_LENGTH);
}

function scheduleCleanup(session: AiRunProgressSession, delayMs: number): void {
  clearTimeout(session.cleanupTimer);

  session.cleanupTimer = setTimeout(() => {
    if (sessions.get(session.operationId) === session) {
      sessions.delete(session.operationId);
    }
  }, delayMs);
  session.cleanupTimer.unref?.();
}

function notify(listener: ProgressListener, event: AiRunProgressEvent): boolean {
  try {
    listener(event);
    return true;
  } catch {
    return false;
  }
}

function emit(
  session: AiRunProgressSession,
  phase: AiRunProgressPhase,
  options: Pick<AiRunProgressEvent, "toolName" | "error"> = {},
): void {
  if (session.terminal) return;

  const previous = session.events.at(-1);
  if (previous?.phase === phase && previous.toolName === options.toolName) return;

  const event = aiRunProgressEventSchema.parse({
    operationId: session.operationId,
    feature: session.feature,
    sequence: session.events.length,
    occurredAt: new Date().toISOString(),
    phase,
    ...options,
  });
  session.events.push(event);

  if (phase === "completed" || phase === "failed") {
    session.terminal = true;
    scheduleCleanup(session, TERMINAL_RETENTION_MS);
  }

  for (const listener of session.listeners) {
    if (!notify(listener, event)) session.listeners.delete(listener);
  }
}

function toolNameForEvent(event: ProviderRunEvent): string | undefined {
  let toolName: string | undefined;
  switch (event.type) {
    case "tool_call":
    case "tool_result":
      toolName = event.tool;
      break;
    case "tool_started":
    case "tool_progress":
    case "tool_completed":
      toolName = event.toolName;
      break;
  }
  return toolName?.trim().slice(0, 120) || undefined;
}

function observeProviderEvent(session: AiRunProgressSession, value: ProviderRunEvent): void {
  const event = providerRunEventSchema.parse(value);
  switch (event.type) {
    case "run_started":
      emit(session, "thinking");
      return;
    case "reasoning_delta":
      emit(session, "thinking");
      return;
    case "text_delta":
      emit(session, "responding");
      return;
    case "tool_call":
    case "tool_started":
    case "tool_progress":
    case "tool_completed":
    case "tool_result":
      emit(session, "using_tool", { toolName: toolNameForEvent(event) });
      return;
    case "run_completed":
      emit(session, "validating");
      return;
    case "run_failed":
    case "run_cancelled":
      emit(session, "failed", { error: "AI run failed." });
      return;
    case "approval_required":
    case "raw_event":
      return;
  }
}

function reporterFor(session: AiRunProgressSession): AiRunProgressReporter {
  return {
    observeProviderEvent(event) {
      observeProviderEvent(session, event);
    },
    emitPhase(phase) {
      emit(session, phase);
    },
    complete() {
      emit(session, "completed");
    },
    fail(error) {
      emit(session, "failed", { error: normalizeError(error) });
    },
  };
}

/** Starts a feature-agnostic, replayable browser-safe AI progress session. */
export function startAiRunProgress({ operationId, feature }: { operationId: string; feature: string }): AiRunProgressReporter {
  const parsed = aiRunProgressOperationParamSchema.parse({ operationId });
  const normalizedFeature = feature.trim();
  if (!normalizedFeature || normalizedFeature.length > 100) {
    throw new Error("feature must be between 1 and 100 characters");
  }

  const existing = sessions.get(parsed.operationId);
  if (existing) {
    if (existing.feature !== normalizedFeature) {
      throw new Error("operationId is already bound to another AI feature");
    }
    return reporterFor(existing);
  }

  const session: AiRunProgressSession = {
    operationId: parsed.operationId,
    feature: normalizedFeature,
    events: [],
    listeners: new Set(),
    terminal: false,
  };
  sessions.set(session.operationId, session);
  scheduleCleanup(session, MAX_SESSION_RETENTION_MS);
  emit(session, "queued");
  return reporterFor(session);
}

/** Subscribes to a run's full replay followed by ordered live progress events. */
export function subscribeToAiRunProgress({
  operationId,
  onEvent,
}: {
  operationId: string;
  onEvent: ProgressListener;
}): AiRunProgressSubscription | null {
  const parsed = aiRunProgressOperationParamSchema.safeParse({ operationId });
  if (!parsed.success) return null;

  const session = sessions.get(parsed.data.operationId);
  if (!session) return null;

  let replaying = true;
  const liveBuffer: AiRunProgressEvent[] = [];
  const listener: ProgressListener = (event) => {
    if (replaying) liveBuffer.push(event);
    else onEvent(event);
  };
  session.listeners.add(listener);
  for (const event of [...session.events]) {
    if (!notify(onEvent, event)) {
      session.listeners.delete(listener);
      return null;
    }
  }
  while (liveBuffer.length > 0) {
    const event = liveBuffer.shift();
    if (event && !notify(onEvent, event)) {
      session.listeners.delete(listener);
      return null;
    }
  }
  replaying = false;

  return {
    unsubscribe() {
      session.listeners.delete(listener);
    },
  };
}

import { Codex, type Thread, type ThreadEvent, type Usage } from "@openai/codex-sdk";
import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  GetRunInput,
  HealthCheckInput,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunEvent,
  ProviderRunInput,
  ProviderRunRef,
  ProviderRunSnapshot,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import { CodexProviderError, type CodexProviderConfig, toCodexOptions, toThreadOptions } from "./types";

const PROVIDER_NAME = "codex";

export type CodexRunner = {
  start(input: StartRunInput): Promise<CodexRunHandle>;
  stream(handle: CodexRunHandle): AsyncIterable<ProviderRunEvent>;
  snapshot(handle: CodexRunHandle): Promise<ProviderRunSnapshot>;
  cancel(handle: CodexRunHandle): Promise<void>;
};

export type CodexProviderOptions = {
  config?: CodexProviderConfig;
  runner?: CodexRunner;
};

export type CodexRunHandle = {
  ref: ProviderRunRef;
  input: StartRunInput;
  abort: AbortController;
  events: AsyncGenerator<ThreadEvent>;
  thread: Thread;
  outputText: string;
  usage: ProviderRunSnapshot["usage"];
  status: ProviderRunRef["status"];
  error?: string;
  timeoutId?: Timer;
  sequence: number;
};

type InternalRun = {
  handle: CodexRunHandle;
  startedAt: string;
  input: StartRunInput;
};

function now() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerRunRef(handle: CodexRunHandle, status = handle.status): ProviderRunRef {
  const threadId = handle.thread.id ?? handle.ref.sessionId;
  return {
    ...handle.ref,
    sessionId: threadId,
    nativeRunId: handle.ref.nativeRunId,
    providerRunId: handle.ref.providerRunId,
    status,
  };
}

function usageFromCodex(usage: Usage | null): ProviderRunSnapshot["usage"] {
  if (!usage) return null;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function inputToPrompt(input: StartRunInput): string {
  return [input.instructions, terminalToolInstruction(input), renderProviderInput(input.input)]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function terminalToolInstruction(input: StartRunInput): string {
  return input.terminalToolName
    ? `When done, call MCP tool ${input.terminalToolName} with final structured result.`
    : "";
}

function renderProviderInput(input: ProviderRunInput): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if ("type" in input && input.type === "text" && typeof input.text === "string") {
      return input.text;
    }
  }
  return JSON.stringify(input, null, 2);
}

function structuredOutputSchema(input: StartRunInput): unknown {
  const schema = input.structuredOutputSchema;
  if (!schema) return undefined;
  return schema.schema;
}

function eventBase(handle: CodexRunHandle, rawEventType?: string) {
  return {
    provider: PROVIDER_NAME,
    runId: handle.ref.runId,
    nativeRunId: handle.ref.nativeRunId,
    sessionId: handle.thread.id ?? handle.ref.sessionId,
    sequence: handle.sequence++,
    timestamp: now(),
    rawEventType,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toolInput(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function normalizeItemEvent(handle: CodexRunHandle, event: Extract<ThreadEvent, { type: "item.started" | "item.updated" | "item.completed" }>): ProviderRunEvent[] {
  const item = event.item;
  const base = eventBase(handle, event.type);
  if (item.type === "agent_message") {
    if (event.type === "item.completed") {
      handle.outputText = item.text;
    }
    return [{ ...base, type: "text_delta", text: item.text }];
  }
  if (item.type === "reasoning") {
    return [{ ...base, type: "reasoning_delta", text: item.text, raw: event }];
  }
  if (item.type === "mcp_tool_call") {
    const status = item.status === "failed" ? "error" : item.status === "completed" ? "completed" : "pending";
    const events: ProviderRunEvent[] = [
      {
        ...base,
        type: "tool_call",
        tool: item.tool,
        callId: item.id,
        input: toolInput(item.arguments),
        status,
      },
    ];
    if (event.type === "item.started") {
      events.push({
        ...eventBase(handle, event.type),
        type: "tool_started",
        toolName: item.tool,
        input: item.arguments,
        raw: event,
      });
    }
    if (event.type === "item.completed") {
      events.push({
        ...eventBase(handle, event.type),
        type: "tool_completed",
        toolName: item.tool,
        error: item.error ? { message: item.error.message } : undefined,
        raw: event,
      });
      if (item.result !== undefined) {
        events.push({
          ...eventBase(handle, event.type),
          type: "tool_result",
          tool: item.tool,
          callId: item.id,
          result: item.result,
        });
      }
    }
    return events;
  }
  if (item.type === "command_execution") {
    const events: ProviderRunEvent[] = [];
    if (event.type === "item.started") {
      events.push({
        ...base,
        type: "tool_started",
        toolName: "command_execution",
        preview: item.command,
        input: { command: item.command },
        raw: event,
      });
    }
    if (event.type === "item.completed") {
      events.push({
        ...base,
        type: "tool_completed",
        toolName: "command_execution",
        error: item.status === "failed" ? { message: `Command failed${typeof item.exit_code === "number" ? ` with exit code ${item.exit_code}` : ""}` } : undefined,
        raw: event,
      });
      if (item.aggregated_output) {
        events.push({ ...eventBase(handle, event.type), type: "text_delta", text: item.aggregated_output });
      }
    }
    return events;
  }
  if (item.type === "error") {
    return [{ ...base, type: "run_failed", run: providerRunRef(handle, "failed"), error: item.message, raw: event }];
  }
  return [{ ...base, type: "raw_event", raw: event }];
}
type Timer = Parameters<typeof clearTimeout>[0];

function clearTimer(timer: Timer | undefined) {
  clearTimeout(timer);
}

class SdkCodexRunner implements CodexRunner {
  private readonly codex: Codex;
  private readonly config: CodexProviderConfig;

  constructor(config: CodexProviderConfig = {}) {
    this.config = config;
    this.codex = new Codex(toCodexOptions(config));
  }

  async start(input: StartRunInput): Promise<CodexRunHandle> {
    const abort = new AbortController();
    const timeout = input.timeoutMs ?? this.config.timeoutMs;
    let timeoutId: Timer | undefined;
    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => abort.abort(), timeout);
    }
    input.signal?.addEventListener("abort", () => abort.abort(), { once: true });

    const thread = input.resumeSessionRef
      ? this.codex.resumeThread(input.resumeSessionRef, toThreadOptions(this.config))
      : this.codex.startThread(toThreadOptions(this.config));
    const streamed = await thread.runStreamed(inputToPrompt(input), {
      outputSchema: structuredOutputSchema(input),
      signal: abort.signal,
    });
    const runId = `codex-run-${crypto.randomUUID()}`;
    const sessionId = input.resumeSessionRef ?? input.sessionId ?? `codex-session-${crypto.randomUUID()}`;
    const handle: CodexRunHandle = {
      ref: {
        provider: PROVIDER_NAME,
        runId,
        nativeRunId: runId,
        providerRunId: runId,
        sessionId,
        status: "running",
        startedAt: now(),
        stream: { supported: true, reconnectable: false },
      },
      input,
      abort,
      events: streamed.events,
      thread,
      outputText: "",
      usage: null,
      status: "running",
      sequence: 0,
      timeoutId,
    };
    return handle;
  }

  async *stream(handle: CodexRunHandle): AsyncIterable<ProviderRunEvent> {
    yield { ...eventBase(handle, "run_started"), type: "run_started", run: providerRunRef(handle) };
    try {
      for await (const event of handle.events) {
        if (event.type === "thread.started") {
          handle.ref.sessionId = event.thread_id;
          continue;
        }
        if (event.type === "turn.completed") {
          handle.usage = usageFromCodex(event.usage);
          continue;
        }
        if (event.type === "turn.failed") {
          clearTimer(handle.timeoutId);
          handle.status = "failed";
          handle.error = event.error.message;
          yield { ...eventBase(handle, event.type), type: "run_failed", run: providerRunRef(handle, "failed"), error: event.error.message, raw: event };
          return;
        }
        if (event.type === "error") {
          clearTimer(handle.timeoutId);
          handle.status = "failed";
          handle.error = event.message;
          yield { ...eventBase(handle, event.type), type: "run_failed", run: providerRunRef(handle, "failed"), error: event.message, raw: event };
          return;
        }
        if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
          for (const providerEvent of normalizeItemEvent(handle, event)) {
            yield providerEvent;
          }
        }
      }
      clearTimer(handle.timeoutId);
      handle.status = handle.abort.signal.aborted ? "cancelled" : "completed";
      if (handle.status === "cancelled") {
        yield { ...eventBase(handle, "cancelled"), type: "run_cancelled", run: providerRunRef(handle, "cancelled") };
        return;
      }
      yield {
        ...eventBase(handle, "completed"),
        type: "run_completed",
        run: providerRunRef(handle, "completed"),
        outputText: handle.outputText,
        output: { text: handle.outputText },
        structuredPayload: parseStructuredPayload(handle.outputText),
        usage: handle.usage,
      };
    } catch (error) {
      clearTimer(handle.timeoutId);
      handle.status = handle.abort.signal.aborted ? "cancelled" : "failed";
      if (handle.status === "cancelled") {
        yield { ...eventBase(handle, "cancelled"), type: "run_cancelled", run: providerRunRef(handle, "cancelled") };
        return;
      }
      handle.error = errorMessage(error);
      yield { ...eventBase(handle, "error"), type: "run_failed", run: providerRunRef(handle, "failed"), error: handle.error, raw: error };
    }
  }

  async snapshot(handle: CodexRunHandle): Promise<ProviderRunSnapshot> {
    return {
      provider: PROVIDER_NAME,
      runId: handle.ref.runId,
      nativeRunId: handle.ref.nativeRunId,
      sessionId: handle.thread.id ?? handle.ref.sessionId,
      status: handle.status ?? "running",
      outputText: handle.outputText,
      structuredPayload: parseStructuredPayload(handle.outputText),
      usage: handle.usage,
      error: handle.error ?? null,
    };
  }

  async cancel(handle: CodexRunHandle): Promise<void> {
    handle.status = "cancelled";
    handle.abort.abort();
  }
}

function parseStructuredPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export class CodexProviderClient implements AgentProviderClient {
  readonly provider = PROVIDER_NAME;
  private readonly runner: CodexRunner;
  private readonly runs = new Map<string, InternalRun>();

  constructor(opts: CodexProviderOptions = {}) {
    this.runner = opts.runner ?? new SdkCodexRunner(opts.config ?? {});
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: true,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      reason: "OpenAI Codex SDK provider",
    };
  }

  async checkHealth(_input: HealthCheckInput = {}): Promise<ProviderHealth> {
    const checkedAt = now();
    return {
      provider: this.provider,
      ok: true,
      checkedAt,
      latencyMs: 0,
      status: "ok",
      reason: "Codex SDK provider configured",
    };
  }

  async createSession(input: CreateSessionInput = {}) {
    const sessionId = input.sessionKey ?? `codex-session-${crypto.randomUUID()}`;
    return {
      provider: this.provider,
      sessionId,
      nativeSessionId: sessionId,
      providerSessionId: sessionId,
      state: "virtual",
      sessionKey: input.sessionKey,
      createdAt: now(),
    };
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    try {
      const handle = await this.runner.start(input);
      this.runs.set(handle.ref.runId, { handle, startedAt: now(), input });
      return handle.ref;
    } catch (error) {
      throw new CodexProviderError(`Codex startRun failed: ${errorMessage(error)}`, {
        retryable: false,
        cause: error,
      });
    }
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const handle = await this.resolveStreamHandle(input);
    for await (const event of this.runner.stream(handle)) {
      yield event;
      if (event.type === "run_completed" || event.type === "run_failed" || event.type === "run_cancelled") {
        return;
      }
    }
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const internal = this.runs.get(input.runId);
    if (!internal) {
      throw new CodexProviderError(`getRun: unknown runId "${input.runId}"`, { retryable: false });
    }
    return this.runner.snapshot(internal.handle);
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const internal = this.runs.get(input.runId);
    if (!internal) {
      throw new CodexProviderError(`cancelRun: unknown runId "${input.runId}"`, { retryable: false });
    }
    await this.runner.cancel(internal.handle);
    return this.runner.snapshot(internal.handle);
  }

  private async resolveStreamHandle(input: StreamRunInput): Promise<CodexRunHandle> {
    if ("runId" in input && input.runId) {
      const internal = this.runs.get(input.runId);
      if (!internal) {
        throw new CodexProviderError(`streamRun: unknown runId "${input.runId}"`, { retryable: false });
      }
      return internal.handle;
    }
    const handle = await this.runner.start(input as StartRunInput);
    this.runs.set(handle.ref.runId, { handle, startedAt: now(), input: input as StartRunInput });
    return handle;
  }
}

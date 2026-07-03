import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  ActiveSession,
  ClientContext,
  ContentBlock,
  InitializeResponse,
  McpServer,
  NewSessionRequest,
  NewSessionResponse,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
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
import { AcpProviderError, type AcpProviderConfig, usageFromAcp } from "./types";

type Timer = Parameters<typeof clearTimeout>[0];

type AcpConnection = {
  context: ClientContext;
  close(error?: unknown): void;
  closed: Promise<void>;
};

export type AcpTransport = {
  connect<T>(
    config: AcpProviderConfig,
    handlers: AcpClientHandlers,
    op: (connection: AcpConnection) => Promise<T>,
  ): Promise<T>;
};

export type AcpClientHandlers = {
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
};

export type AcpRunHandle = {
  ref: ProviderRunRef;
  input: StartRunInput;
  abort: AbortController;
  connection?: AcpConnection;
  sessionId: string;
  session?: ActiveSession;
  prompt?: Promise<unknown>;
  outputText: string;
  usage: ProviderRunSnapshot["usage"];
  status: NonNullable<ProviderRunRef["status"]>;
  error?: string;
  timer?: Timer;
  ready?: Promise<void>;
  sequence: number;
};

type InternalRun = {
  handle: AcpRunHandle;
  startedAt: string;
  input: StartRunInput;
};

type StartRunInputWithControl = StartRunInput & {
  control?: { baseUrl: string; runToken: string };
};

export type AcpProviderOptions = {
  config: AcpProviderConfig;
  transport?: AcpTransport;
};

function now() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stripTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function defaultMcpBaseUrl() {
  const port = process.env.PORT ?? "3101";
  return `http://localhost:${port}`;
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mcpUrlForSession(baseUrl: string, sessionId?: string | null): string {
  const url = new URL(`${stripTrailingSlash(baseUrl)}/api/mcp`);
  const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (trimmedSessionId) url.searchParams.set("session_id", trimmedSessionId);
  return url.toString();
}

function providerRunRef(handle: AcpRunHandle, status = handle.status): ProviderRunRef {
  return {
    ...handle.ref,
    sessionId: handle.sessionId,
    status,
  };
}

function eventBase(config: AcpProviderConfig, handle: AcpRunHandle, rawEventType?: string) {
  return {
    provider: config.provider,
    runId: handle.ref.runId,
    nativeRunId: handle.ref.nativeRunId,
    sessionId: handle.sessionId,
    sequence: handle.sequence++,
    timestamp: now(),
    rawEventType,
  };
}

function renderProviderInput(input: ProviderRunInput): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === "object" && "type" in item && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }
  if ("type" in input && input.type === "text" && typeof input.text === "string") return input.text;
  return JSON.stringify(input, null, 2);
}

function terminalToolInstruction(input: StartRunInput): string | undefined {
  if (!input.terminalToolName) return undefined;
  return [
    `When finished, call the MCP tool \`${input.terminalToolName}\` to submit the final Chrona node result.`,
    "Do not treat this instruction itself as evidence that the tool has run.",
  ].join("\n");
}

function inputToPrompt(input: StartRunInput): ContentBlock[] {
  const text = [
    input.instructions,
    terminalToolInstruction(input),
    renderProviderInput(input.input),
    input.structuredOutputSchema
      ? `Structured output schema:\n${JSON.stringify(input.structuredOutputSchema.schema, null, 2)}`
      : undefined,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
  return [{ type: "text", text }];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toolNameFrom(update: Pick<ToolCall | ToolCallUpdate, "title" | "toolCallId" | "rawInput" | "_meta">) {
  const meta = asRecord(update._meta);
  const chronaMeta = asRecord(meta.chrona);
  const rawInput = asRecord(update.rawInput);
  return (
    stringValue(chronaMeta.toolName) ??
    stringValue(rawInput.tool) ??
    stringValue(rawInput.toolName) ??
    stringValue(rawInput.name) ??
    update.title ??
    update.toolCallId
  );
}

function mapToolStatus(status: ToolCall["status"] | ToolCallUpdate["status"]): "pending" | "completed" | "error" {
  if (status === "completed") return "completed";
  if (status === "failed") return "error";
  return "pending";
}

function textFromContent(content: ContentBlock): string | undefined {
  if (content.type === "text") return content.text;
  return undefined;
}

function normalizeUpdate(config: AcpProviderConfig, handle: AcpRunHandle, update: SessionUpdate): ProviderRunEvent[] {
  const base = eventBase(config, handle, update.sessionUpdate);
  if (update.sessionUpdate === "agent_message_chunk") {
    const text = textFromContent(update.content);
    if (text) handle.outputText += text;
    return text ? [{ ...base, type: "text_delta", text }] : [{ ...base, type: "raw_event", raw: update }];
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    const text = textFromContent(update.content);
    return text ? [{ ...base, type: "reasoning_delta", text, raw: update }] : [{ ...base, type: "raw_event", raw: update }];
  }
  if (update.sessionUpdate === "usage_update") {
    handle.usage = usageFromAcp(update.used, update.size);
    return [{ ...base, type: "raw_event", raw: update }];
  }
  if (update.sessionUpdate === "tool_call") {
    const tool = toolNameFrom(update);
    return [
      {
        ...base,
        type: "tool_call",
        tool,
        callId: update.toolCallId,
        input: asRecord(update.rawInput),
        status: mapToolStatus(update.status),
      },
    ];
  }
  if (update.sessionUpdate === "tool_call_update") {
    const tool = toolNameFrom(update);
    const events: ProviderRunEvent[] = [
      {
        ...base,
        type: "tool_call",
        tool,
        callId: update.toolCallId,
        input: asRecord(update.rawInput),
        status: mapToolStatus(update.status),
      },
    ];
    if (update.status === "in_progress") {
      events.push({ ...eventBase(config, handle, update.sessionUpdate), type: "tool_started", toolName: tool, input: update.rawInput, raw: update });
    }
    if (update.status === "completed" || update.status === "failed") {
      events.push({
        ...eventBase(config, handle, update.sessionUpdate),
        type: "tool_completed",
        toolName: tool,
        error: update.status === "failed" ? { message: "ACP tool call failed", raw: update.rawOutput } : undefined,
        raw: update,
      });
    }
    return events;
  }
  return [{ ...base, type: "raw_event", raw: update }];
}

function permissionOption(options: PermissionOption[]): PermissionOption | undefined {
  return (
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => option.kind === "allow_always") ??
    options.find((option) => option.kind === "reject_once") ??
    options.at(0)
  );
}

export class StdioAcpTransport implements AcpTransport {
  async connect<T>(
    config: AcpProviderConfig,
    handlers: AcpClientHandlers,
    op: (connection: AcpConnection) => Promise<T>,
  ): Promise<T> {
    const subprocess = spawn(config.command, config.args ?? [], {
      cwd: config.cwd,
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    subprocess.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(subprocess.stdin as import("node:stream").Writable) as WritableStream<Uint8Array>,
      Readable.toWeb(subprocess.stdout as import("node:stream").Readable) as unknown as ReadableStream<Uint8Array>,
    );
    const app = acp.client({ name: "chrona" }).onRequest(
      acp.methods.client.session.requestPermission,
      (ctx) => handlers.requestPermission(ctx.params),
    );
    try {
      return await app.connectWith(stream, async (context) => {
        const connection = {
          context,
          close(error?: unknown) {
            subprocess.kill();
            if (error) throw error;
          },
          closed: new Promise<void>((resolve) => subprocess.once("exit", () => resolve())),
        };
        return op(connection);
      });
    } catch (error) {
      throw new AcpProviderError(`ACP process failed: ${errorMessage(error)}${stderr ? `\n${stderr}` : ""}`, {
        cause: error,
        retryable: false,
        provider: config.provider,
      });
    } finally {
      subprocess.kill();
    }
  }
}

function handlers(): AcpClientHandlers {
  return {
    async requestPermission(params) {
      const option = permissionOption(params.options);
      if (!option) return { outcome: { outcome: "cancelled" } };
      return { outcome: { outcome: "selected", optionId: option.optionId } };
    },
  };
}

async function initialize(context: ClientContext, signal?: AbortSignal): Promise<InitializeResponse> {
  return context.request(
    acp.methods.agent.initialize,
    {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "chrona", title: "Chrona", version: "0.1.0" },
    },
    { cancellationSignal: signal },
  );
}

function assertHttpMcp(config: AcpProviderConfig, init: InitializeResponse) {
  if (init.agentCapabilities?.mcpCapabilities?.http !== true) {
    throw new AcpProviderError("ACP agent does not support HTTP MCP servers", { retryable: false, provider: config.provider });
  }
}

function attachActiveSession(context: ClientContext, response: NewSessionResponse): ActiveSession {
  return (context as unknown as { attachSession(response: NewSessionResponse): ActiveSession }).attachSession(response);
}

async function startAcpSession(input: {
  config: AcpProviderConfig;
  context: ClientContext;
  init: InitializeResponse;
  runInput: StartRunInput;
  signal: AbortSignal;
}): Promise<ActiveSession> {
  const request = newSessionRequest(input.config, input.runInput);
  const resumeSessionRef = input.runInput.resumeSessionRef?.trim();

  if (!resumeSessionRef) {
    return input.context.buildSession(request).start({ cancellationSignal: input.signal });
  }

  if (input.init.agentCapabilities?.loadSession !== true) {
    throw new AcpProviderError(`ACP provider cannot resume session "${resumeSessionRef}": agent does not advertise loadSession`, {
      retryable: false,
      provider: input.config.provider,
    });
  }

  const response = await input.context.request(acp.methods.agent.session.load, { ...request, sessionId: resumeSessionRef }, { cancellationSignal: input.signal });
  return attachActiveSession(input.context, { sessionId: resumeSessionRef, ...response });
}

function newSessionRequest(config: AcpProviderConfig, input: StartRunInput): NewSessionRequest {
  const control = (input as StartRunInputWithControl).control;
  const mcpBaseUrl = nonEmpty(control?.baseUrl) ?? nonEmpty(config.mcpBaseUrl) ?? nonEmpty(process.env.CHRONA_MCP_BASE_URL) ?? defaultMcpBaseUrl();
  const mcpRunToken = control?.runToken ?? config.mcpRunToken ?? process.env.CHRONA_API_KEY ?? process.env.CHRONA_MCP_BEARER_TOKEN ?? "";
  const url = mcpUrlForSession(mcpBaseUrl, input.sessionKey ?? input.sessionId);
  const headers = mcpRunToken ? [{ name: "Authorization", value: `Bearer ${mcpRunToken}` }] : [];
  return {
    cwd: config.cwd ?? process.cwd(),
    additionalDirectories: config.additionalDirectories,
    mcpServers: [
      {
        type: "http",
        name: "chrona",
        url,
        headers,
      } satisfies McpServer,
    ],
    _meta: {
      chrona: {
        sessionId: input.sessionId,
        sessionKey: input.sessionKey,
        terminalToolName: input.terminalToolName,
      },
    },
  };
}

export class AcpProviderClient implements AgentProviderClient {
  readonly provider: string;
  private readonly config: AcpProviderConfig;
  private readonly transport: AcpTransport;
  private readonly runs = new Map<string, InternalRun>();

  constructor(opts: AcpProviderOptions) {
    this.config = opts.config;
    this.provider = opts.config.provider;
    this.transport = opts.transport ?? new StdioAcpTransport();
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: false,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      approval: { supported: false, choices: [], scopes: [], resolveAll: false },
      reason: `${this.config.displayName ?? this.provider} ACP provider`,
    };
  }

  async checkHealth(input: HealthCheckInput = {}): Promise<ProviderHealth> {
    const started = Date.now();
    const checkedAt = now();
    try {
      await this.transport.connect(this.config, handlers(), async (connection) => {
        const init = await initialize(connection.context, input.signal);
        assertHttpMcp(this.config, init);
      });
      return {
        provider: this.provider,
        ok: true,
        checkedAt,
        latencyMs: Date.now() - started,
        status: "ok",
        reason: `${this.config.displayName ?? this.provider} ACP agent initialized`,
      };
    } catch (error) {
      return {
        provider: this.provider,
        ok: false,
        checkedAt,
        latencyMs: Date.now() - started,
        status: "error",
        reason: errorMessage(error),
      };
    }
  }

  async createSession(input: CreateSessionInput = {}) {
    const sessionId = input.sessionKey ?? `${this.provider}-session-${crypto.randomUUID()}`;
    return {
      provider: this.provider,
      sessionId,
      nativeSessionId: sessionId,
      providerSessionId: sessionId,
      state: "virtual" as const,
      sessionKey: input.sessionKey,
      createdAt: now(),
    };
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    try {
      const handle = await this.start(input);
      if (input.resumeSessionRef) await handle.ready;
      this.runs.set(handle.ref.runId, { handle, startedAt: now(), input });
      return handle.ref;
    } catch (error) {
      throw new AcpProviderError(`${this.provider} startRun failed: ${errorMessage(error)}`, {
        retryable: false,
        cause: error,
        provider: this.provider,
      });
    }
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    const handle = await this.resolveStreamHandle(input);
    for await (const event of this.stream(handle)) {
      yield event;
    }
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const internal = this.runs.get(input.runId);
    if (!internal) {
      throw new AcpProviderError(`getRun: unknown runId "${input.runId}"`, { retryable: false, provider: this.provider });
    }
    return this.snapshot(internal.handle);
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const internal = this.runs.get(input.runId);
    if (!internal) {
      throw new AcpProviderError(`cancelRun: unknown runId "${input.runId}"`, { retryable: false, provider: this.provider });
    }
    await this.cancel(internal.handle);
    return this.snapshot(internal.handle);
  }

  private async start(input: StartRunInput): Promise<AcpRunHandle> {
    const abort = new AbortController();
    input.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const timeout = input.timeoutMs ?? this.config.timeoutMs;
    const timer = timeout && timeout > 0 ? setTimeout(() => abort.abort(), timeout) : undefined;
    const runId = `${this.provider}-run-${crypto.randomUUID()}`;
    const handle: AcpRunHandle = {
      ref: {
        provider: this.provider,
        runId,
        nativeRunId: runId,
        providerRunId: runId,
        sessionId: input.sessionId,
        status: "running",
        stream: { supported: true, reconnectable: false },
      },
      input,
      abort,
      sessionId: input.sessionId,
      outputText: "",
      usage: null,
      status: "running",
      timer,
      sequence: 0,
    };

    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    handle.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    handle.prompt = this.transport.connect(this.config, handlers(), async (connection) => {
      try {
        handle.connection = connection;
        const init = await initialize(connection.context, abort.signal);
        assertHttpMcp(this.config, init);

        const session = await startAcpSession({
          config: this.config,
          context: connection.context,
          init,
          runInput: input,
          signal: abort.signal,
        });
        handle.session = session;
        handle.sessionId = session.sessionId;
        handle.ref.sessionId = session.sessionId;
        resolveReady();
        return session.prompt(inputToPrompt(input), { cancellationSignal: abort.signal });
      } catch (error) {
        rejectReady(error);
        throw error;
      }
    });
    void handle.prompt.catch(() => undefined);

    return handle;
  }

  private async *stream(handle: AcpRunHandle): AsyncIterable<ProviderRunEvent> {
    await handle.ready;
    yield { ...eventBase(this.config, handle, "run_started"), type: "run_started", run: providerRunRef(handle) };
    try {
      for (;;) {
        const message = await handle.session?.nextUpdate();
        if (!message) break;
        if (message.kind === "stop") {
          clearTimeout(handle.timer);
          if (message.stopReason === "cancelled" || handle.abort.signal.aborted) {
            handle.status = "cancelled";
            yield { ...eventBase(this.config, handle, "cancelled"), type: "run_cancelled", run: providerRunRef(handle, "cancelled") };
            return;
          }
          handle.status = "completed";
          yield {
            ...eventBase(this.config, handle, "completed"),
            type: "run_completed",
            run: providerRunRef(handle, "completed"),
            outputText: handle.outputText,
            output: { text: handle.outputText },
            structuredPayload: parseStructuredPayload(handle.outputText),
            usage: handle.usage,
            raw: message.response,
          };
          return;
        }
        for (const event of normalizeUpdate(this.config, handle, message.update)) yield event;
      }
      await handle.prompt;
    } catch (error) {
      clearTimeout(handle.timer);
      handle.status = handle.abort.signal.aborted ? "cancelled" : "failed";
      if (handle.status === "cancelled") {
        yield { ...eventBase(this.config, handle, "cancelled"), type: "run_cancelled", run: providerRunRef(handle, "cancelled") };
        return;
      }
      handle.error = errorMessage(error);
      yield { ...eventBase(this.config, handle, "error"), type: "run_failed", run: providerRunRef(handle, "failed"), error: handle.error };
    } finally {
      clearTimeout(handle.timer);
      handle.session?.dispose();
    }
  }

  private async snapshot(handle: AcpRunHandle): Promise<ProviderRunSnapshot> {
    return {
      provider: this.provider,
      runId: handle.ref.runId,
      nativeRunId: handle.ref.nativeRunId,
      providerRunId: handle.ref.providerRunId,
      sessionId: handle.sessionId,
      status: handle.status,
      outputText: handle.outputText,
      output: { text: handle.outputText },
      structuredPayload: parseStructuredPayload(handle.outputText),
      usage: handle.usage,
      error: handle.error ?? null,
    };
  }

  private async cancel(handle: AcpRunHandle): Promise<void> {
    handle.abort.abort();
    if (handle.connection) {
      await handle.connection.context.notify(acp.methods.agent.session.cancel, { sessionId: handle.sessionId });
    }
    handle.status = "cancelled";
  }

  private async resolveStreamHandle(input: StreamRunInput): Promise<AcpRunHandle> {
    if ("runId" in input && input.runId) {
      const internal = this.runs.get(input.runId);
      if (!internal) {
        throw new AcpProviderError(`streamRun: unknown runId "${input.runId}"`, { retryable: false, provider: this.provider });
      }
      return internal.handle;
    }
    const handle = await this.start(input as StartRunInput);
    this.runs.set(handle.ref.runId, { handle, startedAt: now(), input: input as StartRunInput });
    return handle;
  }
}

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
import {
  CodexProviderError,
  codexAcpCommand,
  codexAcpEnv,
  type CodexProviderConfig,
  usageFromAcp,
} from "./types";

const PROVIDER_NAME = "codex";

type Timer = Parameters<typeof clearTimeout>[0];

type AcpConnection = {
  context: ClientContext;
  close(error?: unknown): void;
  closed: Promise<void>;
};

export type AcpTransport = {
  connect<T>(
    config: CodexProviderConfig,
    handlers: AcpClientHandlers,
    op: (connection: AcpConnection) => Promise<T>,
  ): Promise<T>;
};

export type AcpClientHandlers = {
  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse>;
};

export type CodexRunner = {
  start(input: StartRunInput): Promise<CodexRunHandle>;
  stream(handle: CodexRunHandle): AsyncIterable<ProviderRunEvent>;
  snapshot(handle: CodexRunHandle): Promise<ProviderRunSnapshot>;
  cancel(handle: CodexRunHandle): Promise<void>;
  checkHealth(input?: HealthCheckInput): Promise<ProviderHealth>;
};

export type CodexProviderOptions = {
  config?: CodexProviderConfig;
  runner?: CodexRunner;
};

export type CodexRunHandle = {
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
  handle: CodexRunHandle;
  startedAt: string;
  input: StartRunInput;
};

type StartRunInputWithControl = StartRunInput & {
  control?: { baseUrl: string; runToken: string };
};

function now() {
  return new Date().toISOString();
}

function clearTimer(timer: Timer | undefined) {
  clearTimeout(timer);
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

function providerRunRef(handle: CodexRunHandle, status = handle.status): ProviderRunRef {
  return {
    ...handle.ref,
    sessionId: handle.sessionId,
    status,
  };
}

function eventBase(handle: CodexRunHandle, rawEventType?: string) {
  return {
    provider: PROVIDER_NAME,
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

function normalizeUpdate(handle: CodexRunHandle, update: SessionUpdate): ProviderRunEvent[] {
  const base = eventBase(handle, update.sessionUpdate);
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
      events.push({ ...eventBase(handle, update.sessionUpdate), type: "tool_started", toolName: tool, input: update.rawInput, raw: update });
    }
    if (update.status === "completed" || update.status === "failed") {
      events.push({
        ...eventBase(handle, update.sessionUpdate),
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

class StdioAcpTransport implements AcpTransport {
  async connect<T>(
    config: CodexProviderConfig,
    handlers: AcpClientHandlers,
    op: (connection: AcpConnection) => Promise<T>,
  ): Promise<T> {
    const subprocess = spawn(codexAcpCommand(config), [], {
      cwd: config.cwd,
      env: codexAcpEnv(config),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    subprocess.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    const stream = acp.ndJsonStream(
      WritableStreamFromNode(subprocess.stdin),
      ReadableStreamFromNode(subprocess.stdout),
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
      throw new CodexProviderError(`Codex ACP process failed: ${errorMessage(error)}${stderr ? `\n${stderr}` : ""}`, {
        cause: error,
        retryable: false,
      });
    } finally {
      subprocess.kill();
    }
  }
}

function WritableStreamFromNode(stream: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return Writable.toWeb(stream as import("node:stream").Writable) as WritableStream<Uint8Array>;
}

function ReadableStreamFromNode(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as import("node:stream").Readable) as unknown as ReadableStream<Uint8Array>;
}

export class AcpCodexRunner implements CodexRunner {
  private readonly config: CodexProviderConfig;
  private readonly transport: AcpTransport;

  constructor(config: CodexProviderConfig = {}, transport: AcpTransport = new StdioAcpTransport()) {
    this.config = config;
    this.transport = transport;
  }

  async checkHealth(input: HealthCheckInput = {}): Promise<ProviderHealth> {
    const started = Date.now();
    const checkedAt = now();
    try {
      await this.transport.connect(this.config, handlers(), async (connection) => {
        const init = await initialize(connection.context, input.signal);
        assertHttpMcp(init);
      });
      return {
        provider: PROVIDER_NAME,
        ok: true,
        checkedAt,
        latencyMs: Date.now() - started,
        status: "ok",
        reason: "Codex ACP agent initialized",
      };
    } catch (error) {
      return {
        provider: PROVIDER_NAME,
        ok: false,
        checkedAt,
        latencyMs: Date.now() - started,
        status: "error",
        reason: errorMessage(error),
      };
    }
  }

  async start(input: StartRunInput): Promise<CodexRunHandle> {
    const abort = new AbortController();
    input.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const timeout = input.timeoutMs ?? this.config.timeoutMs;
    const timer = timeout && timeout > 0 ? setTimeout(() => abort.abort(), timeout) : undefined;
    const runId = `codex-run-${crypto.randomUUID()}`;
    const handle: CodexRunHandle = {
      ref: {
        provider: PROVIDER_NAME,
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
        assertHttpMcp(init);
        const session = await connection.context.buildSession(newSessionRequest(this.config, input)).start({ cancellationSignal: abort.signal });
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

    return handle;
  }

  async *stream(handle: CodexRunHandle): AsyncIterable<ProviderRunEvent> {
    await handle.ready;
    yield { ...eventBase(handle, "run_started"), type: "run_started", run: providerRunRef(handle) };
    try {
      for (;;) {
        const message = await handle.session?.nextUpdate();
        if (!message) break;
        if (message.kind === "stop") {
          clearTimer(handle.timer);
          if (message.stopReason === "cancelled" || handle.abort.signal.aborted) {
            handle.status = "cancelled";
            yield { ...eventBase(handle, "cancelled"), type: "run_cancelled", run: providerRunRef(handle, "cancelled") };
            return;
          }
          handle.status = "completed";
          yield {
            ...eventBase(handle, "completed"),
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
        for (const event of normalizeUpdate(handle, message.update)) yield event;
      }
      await handle.prompt;
    } catch (error) {
      clearTimer(handle.timer);
      handle.status = handle.abort.signal.aborted ? "cancelled" : "failed";
      if (handle.status === "cancelled") {
        yield { ...eventBase(handle, "cancelled"), type: "run_cancelled", run: providerRunRef(handle, "cancelled") };
        return;
      }
      handle.error = errorMessage(error);
      yield { ...eventBase(handle, "error"), type: "run_failed", run: providerRunRef(handle, "failed"), error: handle.error };
    } finally {
      clearTimer(handle.timer);
      handle.session?.dispose();
    }
  }

  async snapshot(handle: CodexRunHandle): Promise<ProviderRunSnapshot> {
    return {
      provider: PROVIDER_NAME,
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

  async cancel(handle: CodexRunHandle): Promise<void> {
    handle.abort.abort();
    if (handle.connection) {
      await handle.connection.context.notify(acp.methods.agent.session.cancel, { sessionId: handle.sessionId });
    }
    handle.status = "cancelled";
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

function assertHttpMcp(init: InitializeResponse) {
  if (init.agentCapabilities?.mcpCapabilities?.http !== true) {
    throw new CodexProviderError("Codex ACP agent does not support HTTP MCP servers", { retryable: false });
  }
}

function newSessionRequest(config: CodexProviderConfig, input: StartRunInput): NewSessionRequest {
  const control = (input as StartRunInputWithControl).control;
  const mcpBaseUrl = stripTrailingSlash(control?.baseUrl ?? config.mcpBaseUrl ?? process.env.CHRONA_MCP_BASE_URL ?? defaultMcpBaseUrl());
  const mcpRunToken = control?.runToken ?? config.mcpRunToken ?? process.env.CHRONA_API_KEY ?? process.env.CHRONA_MCP_BEARER_TOKEN ?? "";
  const url = `${mcpBaseUrl}/api/mcp`;
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

export class CodexProviderClient implements AgentProviderClient {
  readonly provider = PROVIDER_NAME;
  private readonly runner: CodexRunner;
  private readonly runs = new Map<string, InternalRun>();

  constructor(opts: CodexProviderOptions = {}) {
    this.runner = opts.runner ?? new AcpCodexRunner(opts.config ?? {});
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
      reason: "OpenAI Codex ACP provider",
    };
  }

  checkHealth(input: HealthCheckInput = {}): Promise<ProviderHealth> {
    return this.runner.checkHealth(input);
  }

  async createSession(input: CreateSessionInput = {}) {
    const sessionId = input.sessionKey ?? `codex-session-${crypto.randomUUID()}`;
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

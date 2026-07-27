import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { Readable as NodeReadable, Writable as NodeWritable } from "node:stream";
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
  ProviderApprovalChoice,
  ProviderApprovalRequest,
  ProviderApprovalResolution,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunEvent,
  ProviderRunInput,
  ProviderRunRef,
  ProviderRunSnapshot,
  ResolveProviderApprovalInput,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import { AcpProviderError, type AcpProviderConfig, usageFromAcp } from "./types";

type Timer = Parameters<typeof clearTimeout>[0];

type AcpConnection = {
  context: ClientContext;
  close(error?: unknown): void;
  closed: Promise<void>;
  diagnostics?: { stderr(): string };
};

export type AcpDiagnostics = {
  details(): string;
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
  toolLabels: Map<string, string>;
  approvalEvents: ProviderRunEvent[];
  approvalWaiters: Array<() => void>;
};

type InternalRun = {
  handle: AcpRunHandle;
  startedAt: string;
  input: StartRunInput;
};

type PendingAcpApproval = {
  handle: AcpRunHandle;
  request: ProviderApprovalRequest;
  optionByChoice: Map<ProviderApprovalChoice, string>;
  resolve(response: RequestPermissionResponse): void;
};

type StartRunInputWithControl = StartRunInput & {
  control?: { baseUrl?: string; runToken?: string };
};

export type AcpProviderOptions = {
  config: AcpProviderConfig;
  transport?: AcpTransport;
  diagnostics?: AcpDiagnostics;
};

function now() {
  return new Date().toISOString();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorMessageChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current) {
    const message = errorMessage(current).trim();
    if (message) messages.push(message);
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join("\n");
}

function providerErrorMessage(error: unknown, diagnostics = "") {
  const message = errorMessage(error);
  const details = `${errorMessageChain(error)}\n${diagnostics}`;
  const upstreamStatus = details.match(/(?:status=|unexpected status:?\s*)(\d{3})(?:\s+([A-Za-z][A-Za-z ]+?))?(?=\s+headers=|[\n"}]|$)/);
  if (upstreamStatus?.[1] === "401" || upstreamStatus?.[1] === "403") {
    const reason = statusReason(upstreamStatus[1], upstreamStatus[2]);
    return `${message}: upstream provider authentication failed (${upstreamStatus[1]} ${reason}). Check provider API key and base URL.`;
  }
  if (upstreamStatus) {
    const reason = statusReason(upstreamStatus[1], upstreamStatus[2]);
    return `${message}: upstream provider request failed (${upstreamStatus[1]} ${reason}).`;
  }
  return message;
}

function statusReason(code: string, reason?: string) {
  const trimmed = reason?.trim();
  if (trimmed) return trimmed;
  if (code === "401") return "Unauthorized";
  if (code === "403") return "Forbidden";
  return "HTTP error";
}


const CHRONA_PLAN_GENERATE_TOOL_NAME = "chrona_plan_generate";
const MCP_PROBE_TIMEOUT_MS = 5_000;
const MCP_PROBE_PROTOCOL_VERSION = "2025-03-26";

type ChronaMcpConnection = {
  baseUrl: string;
  token: string;
  url: string;
  headers: Array<{ name: string; value: string }>;
};

function toolNamesFromMcpBody(text: string): string[] {
  const tools: string[] = [];
  try {
    const parsed = JSON.parse(text) as { result?: { tools?: Array<{ name?: unknown }> } };
    if (Array.isArray(parsed.result?.tools)) {
      for (const tool of parsed.result.tools) {
        if (typeof tool.name === "string") tools.push(tool.name);
      }
      return tools;
    }
  } catch {
    /* fall through to SSE frame scan */
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as { result?: { tools?: Array<{ name?: unknown }> } };
      if (Array.isArray(parsed.result?.tools)) {
        for (const tool of parsed.result.tools) {
          if (typeof tool.name === "string") tools.push(tool.name);
        }
      }
    } catch {
      /* ignore non-JSON SSE frames */
    }
  }
  return tools;
}

function chronaMcpConnection(config: AcpProviderConfig, sessionId?: string | null, control?: StartRunInputWithControl["control"]): ChronaMcpConnection {
  const baseUrl = nonEmpty(control?.baseUrl) ?? nonEmpty(config.mcpBaseUrl) ?? nonEmpty(process.env.CHRONA_MCP_BASE_URL) ?? defaultMcpBaseUrl();
  const token = control?.runToken ?? config.mcpRunToken ?? process.env.CHRONA_API_KEY ?? process.env.CHRONA_MCP_BEARER_TOKEN ?? "";
  const headers = token ? [{ name: "Authorization", value: `Bearer ${token}` }] : [];
  return {
    baseUrl: stripTrailingSlash(baseUrl),
    token,
    url: mcpUrlForSession(baseUrl, sessionId),
    headers,
  };
}

function mcpFetchHeaders(input: { token: string; sessionId?: string | null }): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (input.sessionId) headers["Mcp-Session-Id"] = input.sessionId;
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  return headers;
}

async function probeChronaMcpTools(input: { config: AcpProviderConfig; sessionId: string; signal?: AbortSignal }) {
  const mcp = chronaMcpConnection(input.config, input.sessionId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_PROBE_TIMEOUT_MS);
  timeout.unref?.();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });

  let initializeResponse: Response;
  try {
    initializeResponse = await fetch(mcp.url, {
      method: "POST",
      headers: mcpFetchHeaders({ token: mcp.token }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROBE_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "chrona-acp-preflight", version: "0.0.0" },
        },
      }),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new AcpProviderError(`Chrona MCP server at ${mcp.url} is unreachable: ${errorMessage(cause)}`, {
      cause,
      retryable: true,
      provider: input.config.provider,
    });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }

  const status = initializeResponse.status;
  if (status === 401 || status === 403) {
    throw new AcpProviderError(
      `Chrona MCP server rejected the Bearer token (HTTP ${status}). Set CHRONA_API_KEY to the server's API_KEY, or pass mcpRunToken in the client config.`,
      { retryable: false, provider: input.config.provider },
    );
  }
  if (!initializeResponse.ok) {
    const body = await initializeResponse.text().catch(() => "");
    throw new AcpProviderError(`Chrona MCP server returned HTTP ${status} for initialize: ${body.slice(0, 200)}`, {
      retryable: false,
      provider: input.config.provider,
    });
  }

  const mcpSessionId = initializeResponse.headers.get("mcp-session-id");
  const toolsResponse = await fetch(mcp.url, {
    method: "POST",
    headers: mcpFetchHeaders({ token: mcp.token, sessionId: mcpSessionId }),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    signal: input.signal,
  });
  if (!toolsResponse.ok) {
    const body = await toolsResponse.text().catch(() => "");
    throw new AcpProviderError(`Chrona MCP server returned HTTP ${toolsResponse.status} for tools/list: ${body.slice(0, 200)}`, {
      retryable: false,
      provider: input.config.provider,
    });
  }

  const toolNames = toolNamesFromMcpBody(await toolsResponse.text());
  if (!toolNames.includes(CHRONA_PLAN_GENERATE_TOOL_NAME)) {
    throw new AcpProviderError(
      `Chrona MCP tools missing required tool ${CHRONA_PLAN_GENERATE_TOOL_NAME}. Loaded tools: ${toolNames.length > 0 ? toolNames.join(", ") : "none"}.`,
      { retryable: false, provider: input.config.provider },
    );
  }
  return toolNames;
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
  if (input.terminalToolName === "chrona_plan_generate") {
    return [
      "When the plan is ready, call the MCP tool `chrona_plan_generate` with the complete PlanBlueprint object.",
      "Do not answer only in text; the plan is not submitted until that MCP tool call succeeds.",
    ].join("\n");
  }
  return [
    `When finished, call the MCP tool \`${input.terminalToolName}\` with the final structured payload required by the current Chrona instructions.`,
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

function rememberToolLabel(handle: AcpRunHandle, update: Pick<ToolCall | ToolCallUpdate, "title" | "toolCallId" | "rawInput" | "_meta">) {
  const tool = toolNameFrom(update);
  if (tool !== update.toolCallId) {
    handle.toolLabels.set(update.toolCallId, tool);
    return tool;
  }
  return handle.toolLabels.get(update.toolCallId) ?? tool;
}
function normalizeUpdate(config: AcpProviderConfig, handle: AcpRunHandle, update: SessionUpdate): ProviderRunEvent[] {
  const base = eventBase(config, handle, update.sessionUpdate);
  if (update.sessionUpdate === "agent_message_chunk") {
    const text = textFromContent(update.content) ?? "";
    handle.outputText += text;
    return [{ ...base, type: "text_delta", text }];
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    const text = textFromContent(update.content) ?? "";
    return [{ ...base, type: "reasoning_delta", text }];
  }
  if (update.sessionUpdate === "usage_update") {
    handle.usage = usageFromAcp(update.used, update.size);
    return [{ ...base, type: "raw_event", raw: update }];
  }
  if (update.sessionUpdate === "tool_call") {
    const tool = rememberToolLabel(handle, update);
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
    const tool = rememberToolLabel(handle, update);
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

function approvalChoiceForOption(option: PermissionOption): ProviderApprovalChoice {
  if (option.kind === "reject_once" || option.kind === "reject_always") return "deny";
  if (option.kind === "allow_always") return "approve_always";
  return "approve_once";
}

function approvalRequestFromAcp(config: AcpProviderConfig, handle: AcpRunHandle, params: RequestPermissionRequest): {
  request: ProviderApprovalRequest;
  optionByChoice: Map<ProviderApprovalChoice, string>;
} {
  const optionByChoice = new Map<ProviderApprovalChoice, string>();
  const choices: ProviderApprovalChoice[] = [];
  for (const option of params.options) {
    const choice = approvalChoiceForOption(option);
    if (!optionByChoice.has(choice)) {
      optionByChoice.set(choice, option.optionId);
      choices.push(choice);
    }
  }
  if (choices.length === 0) choices.push("deny");
  const tool = params.toolCall.title?.trim() || params.toolCall.toolCallId;
  const approvalId = `${params.sessionId}:${params.toolCall.toolCallId}`;
  return {
    request: {
      id: approvalId,
      provider: config.provider,
      runId: handle.ref.runId,
      nativeRunId: handle.ref.nativeRunId,
      sessionId: params.sessionId,
      kind: "acp_permission",
      providerKind: params.toolCall.kind ?? "tool_call",
      title: `Approve ${tool}`,
      summary: `ACP provider requests permission for ${tool}.`,
      riskLevel: "unknown",
      subject: { type: "tool", label: tool, preview: JSON.stringify(params.toolCall.rawInput ?? params.toolCall.content ?? null) },
      choices,
      defaultChoice: choices.includes("deny") ? "deny" : choices.at(0),
      recommendedChoice: choices.includes("approve_once") ? "approve_once" : choices.at(0),
      scopePolicy: {
        supportsOnce: params.options.some((option) => option.kind === "allow_once"),
        supportsSession: false,
        supportsAlways: params.options.some((option) => option.kind === "allow_always"),
        supportsResolveAll: false,
      },
      raw: params,
    },
    optionByChoice,
  };
}

function queueApprovalEvent(handle: AcpRunHandle, event: ProviderRunEvent) {
  handle.approvalEvents.push(event);
  const waiters = handle.approvalWaiters.splice(0);
  for (const wake of waiters) wake();
}

function waitForApprovalEvent(handle: AcpRunHandle) {
  return new Promise<void>((resolve) => handle.approvalWaiters.push(resolve));
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
      Writable.toWeb(subprocess.stdin as NodeWritable) as WritableStream<Uint8Array>,
      Readable.toWeb(subprocess.stdout as NodeReadable) as unknown as ReadableStream<Uint8Array>,
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
          diagnostics: { stderr: () => stderr },
        };
        return op(connection);
      });
    } catch (error) {
      throw new AcpProviderError(`ACP process failed: ${providerErrorMessage(error, stderr)}${stderr ? `\n${stderr}` : ""}`, {
        cause: error,
        retryable: false,
        provider: config.provider,
      });
    } finally {
      subprocess.kill();
    }
  }
}

function handlers(requestPermission?: (params: RequestPermissionRequest) => Promise<RequestPermissionResponse>): AcpClientHandlers {
  return {
    async requestPermission(params) {
      if (requestPermission) return requestPermission(params);
      const option = permissionOption(params.options);
      if (!option) return { outcome: { outcome: "cancelled" } };
      return { outcome: { outcome: "selected", optionId: option.optionId } };
    },
  };
}
async function checkAcpSessionHealth(config: AcpProviderConfig, context: ClientContext, signal?: AbortSignal) {
  const sessionId = `${config.provider}-health-${crypto.randomUUID()}`;
  const sessionKey = `chrona:provider-health:${config.provider}:plan-generation`;
  await probeChronaMcpTools({ config, sessionId: sessionKey, signal });
  const session = await context.buildSession(newSessionRequest(config, {
    sessionId,
    sessionKey,
    instructions: "Health check.",
    input: { type: "text", text: "Health check." },
  })).start({ cancellationSignal: signal });
  session.dispose();
}


async function initialize(config: AcpProviderConfig, context: ClientContext, signal?: AbortSignal): Promise<InitializeResponse> {
  return context.request(
    acp.methods.agent.initialize,
    {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { auth: { terminal: config.auth?.terminal === true } },
      clientInfo: { name: "chrona", title: "Chrona", version: "0.1.0" },
    },
    { cancellationSignal: signal },
  );
}

type AdvertisedAuthMethod = { id?: unknown; type?: unknown; name?: unknown };

function chooseAuthMethod(config: AcpProviderConfig, init: InitializeResponse): string | null {
  const methods = (init.authMethods ?? []) as AdvertisedAuthMethod[];
  if (methods.length === 0) return null;
  const configured = config.auth?.methodId?.trim();
  if (configured) return methods.some((method) => method.id === configured) ? configured : null;
  const preferred = config.auth?.prefer ?? "agent";
  const match = methods.find((method) => (method.type ?? "agent") === preferred) ?? methods.find((method) => (method.type ?? "agent") === "agent");
  return typeof match?.id === "string" && match.id.trim().length > 0 ? match.id : null;
}

async function authenticate(config: AcpProviderConfig, context: ClientContext, init: InitializeResponse, signal?: AbortSignal) {
  const methodId = chooseAuthMethod(config, init);
  if (!methodId) return;
  await context.request(acp.methods.agent.authenticate, { methodId }, { cancellationSignal: signal });
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
  const mcp = chronaMcpConnection(config, input.sessionKey ?? input.sessionId, (input as StartRunInputWithControl).control);
  return {
    cwd: config.cwd ?? process.cwd(),
    additionalDirectories: config.additionalDirectories,
    mcpServers: input.toolPolicy === "read_only"
      ? []
      : [
          {
            type: "http",
            name: "chrona",
            url: mcp.url,
            headers: mcp.headers,
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
  private readonly diagnostics?: AcpDiagnostics;
  private readonly runs = new Map<string, InternalRun>();
  private readonly pendingApprovals = new Map<string, PendingAcpApproval>();

  constructor(opts: AcpProviderOptions) {
    this.config = opts.config;
    this.provider = opts.config.provider;
    this.transport = opts.transport ?? new StdioAcpTransport();
    this.diagnostics = opts.diagnostics;
  }

  getCapabilities(): ProviderCapabilities {
    return {
      supportsSessions: true,
      supportsStreaming: true,
      supportsRunLookup: false,
      supportsCancellation: true,
      supportsToolCalls: true,
      supportsPreviousResponse: false,
      approval: { supported: true, choices: ["approve_once", "approve_always", "deny"], scopes: ["once", "always"], resolveAll: false },
      recovery: {
        sessionResume: true,
        historyReplay: true,
        activeRunLookup: false,
        streamReconnect: false,
        mode: "session_history",
      },
      reason: `${this.config.displayName ?? this.provider} ACP provider`,
    };
  }

  async checkHealth(input: HealthCheckInput = {}): Promise<ProviderHealth> {
    const started = Date.now();
    const checkedAt = now();
    try {
      await this.transport.connect(this.config, handlers(), async (connection) => {
        const init = await initialize(this.config, connection.context, input.signal);
        await authenticate(this.config, connection.context, init, input.signal);
        assertHttpMcp(this.config, init);
        if (this.config.healthCheck === "session") await checkAcpSessionHealth(this.config, connection.context, input.signal);
      });
      return {
        provider: this.provider,
        ok: true,
        checkedAt,
        latencyMs: Date.now() - started,
        status: "ok",
        reason: this.config.healthCheck === "session" ? `${this.config.displayName ?? this.provider} ACP agent connected` : `${this.config.displayName ?? this.provider} ACP agent initialized`,
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
      throw new AcpProviderError(`${this.provider} startRun failed: ${providerErrorMessage(error, this.diagnosticDetails())}`, {
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

  async resolveApproval(input: ResolveProviderApprovalInput): Promise<ProviderApprovalResolution> {
    const internal = this.runs.get(input.runId);
    if (!internal) {
      return { provider: this.provider, runId: input.runId, nativeRunId: input.nativeRunId, choice: input.choice, resolved: 0, status: "not_active" };
    }
    const pending = Array.from(this.pendingApprovals.values()).find((approval) =>
      approval.handle.ref.runId === input.runId && (!input.approvalId || approval.request.id === input.approvalId)
    );
    if (!pending) {
      return { provider: this.provider, runId: input.runId, nativeRunId: input.nativeRunId, choice: input.choice, resolved: 0, status: "not_pending" };
    }
    const optionId = pending.optionByChoice.get(input.choice);
    pending.resolve(optionId ? { outcome: { outcome: "selected", optionId } } : { outcome: { outcome: "cancelled" } });
    this.pendingApprovals.delete(pending.request.id ?? "");
    return { provider: this.provider, runId: input.runId, nativeRunId: input.nativeRunId, choice: input.choice, resolved: 1, status: "resolved" };
  }

  private async requestPermission(handle: AcpRunHandle, params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const mapped = approvalRequestFromAcp(this.config, handle, params);
    const approvalId = mapped.request.id ?? `${handle.ref.runId}:${params.toolCall.toolCallId}`;
    const response = await new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingApprovals.set(approvalId, { handle, request: mapped.request, optionByChoice: mapped.optionByChoice, resolve });
      queueApprovalEvent(handle, {
        ...eventBase(this.config, handle, "approval_required"),
        type: "approval_required",
        approval: mapped.request,
        raw: params,
      });
    });
    this.pendingApprovals.delete(approvalId);
    return response;
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
      approvalEvents: [],
      toolLabels: new Map(),

      approvalWaiters: [],
    };

    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    handle.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    handle.prompt = this.transport.connect(this.config, handlers((params) => this.requestPermission(handle, params)), async (connection) => {
      try {
        handle.connection = connection;
        const init = await initialize(this.config, connection.context, abort.signal);
        await authenticate(this.config, connection.context, init, abort.signal);
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
        const queuedApproval = handle.approvalEvents.shift();
        if (queuedApproval) {
          yield queuedApproval;
          continue;
        }
        const session = handle.session;
        if (!session) break;
        const next = await Promise.race([
          session.nextUpdate().then((message) => ({ kind: "message" as const, message })),
          waitForApprovalEvent(handle).then(() => ({ kind: "approval" as const })),
        ]);
        if (next.kind === "approval") continue;
        const message = next.message;
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
      handle.error = providerErrorMessage(error, this.diagnosticDetails(handle.connection));
      yield { ...eventBase(this.config, handle, "error"), type: "run_failed", run: providerRunRef(handle, "failed"), error: handle.error };
    } finally {
      clearTimeout(handle.timer);
      handle.session?.dispose();
    }
  }

  private diagnosticDetails(connection?: AcpConnection) {
    return [connection?.diagnostics?.stderr(), this.diagnostics?.details()].filter((part) => part && part.trim().length > 0).join("\n");
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

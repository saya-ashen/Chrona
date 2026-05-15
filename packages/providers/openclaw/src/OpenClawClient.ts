import { OPENCLAW_DEFAULT_MODEL } from "@chrona/contracts";
import type {
  AgentProviderClient,
  CancelRunInput,
  CreateSessionInput,
  GetRunInput,
  HealthCheckInput,
  ProviderCapabilities,
  ProviderHealth,
  ProviderRunEvent,
  ProviderRunRef,
  ProviderRunSnapshot,
  ProviderRunStatus,
  ProviderSessionRef,
  StartRunInput,
  StreamRunInput,
} from "@chrona/providers-foundation";
import {
  buildGatewayBody,
  checkGatewayAvailable,
  commitGatewayTurnState,
  gatewayHeaders,
  mapUsage,
  normalizeGatewayHttpUrl,
  parseFunctionItems,
  resolveRequestedFunctionToolName,
} from "./gateway";
import { buildStructuredResult, extractOutputText } from "./feature-contracts";
import type {
  BridgeEnvironment,
  BridgeRequest,
  OpenClawClientConfig,
  OpenClawToolCall,
} from "./types";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

type OpenClawGatewayRunRequest = {
  request: BridgeRequest;
  signal?: AbortSignal;
};

type OpenClawGatewayStreamEvent = {
  type: "text" | "tool_call" | "tool_result" | "done" | "error";
  data: string;
  toolCall?: OpenClawToolCall;
};

export type OpenClawConnectionConfig = {
  bridgeUrl?: string;
  bridgeToken?: string;
  timeoutSeconds?: number;
  mode?: "live" | "mock";
};

const OPENCLAW_PROVIDER = "openclaw";

const OPENCLAW_CAPABILITIES: ProviderCapabilities = {
  supportsSessions: true,
  supportsStreaming: true,
  supportsRunLookup: true,
  supportsCancellation: true,
  supportsToolCalls: true,
  supportsPreviousResponse: true,
};

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function extractFunctionCallsFromOutput(
  output: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(output)) return [];
  return output.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function safeDebugSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "unknown"
  );
}

function openClawDumpEnabled() {
  return ["1", "true", "yes", "on"].includes(
    (process.env.CHRONA_OPENCLAW_DUMP ?? "").trim().toLowerCase(),
  );
}

function openClawDumpDirectory() {
  return (
    process.env.CHRONA_OPENCLAW_DUMP_DIR?.trim() ||
    join(process.cwd(), ".chrona-debug", "openclaw")
  );
}

function isoNow() {
  return new Date().toISOString();
}

function timeoutSignal(input: {
  signal?: AbortSignal;
  timeoutMs?: number;
  timeoutSeconds?: number;
}) {
  const timeoutMs =
    input.timeoutMs ?? ((input.timeoutSeconds ?? 300) + 15) * 1000;
  return input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

function mapProviderRunStatus(status: unknown): ProviderRunStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "in_progress":
      return "running";
    case "requires_action":
      return "waiting_for_approval";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

function getResponseId(response: Record<string, unknown>) {
  return typeof response.id === "string" ? response.id : undefined;
}

function buildBridgeRequest(input: StartRunInput): BridgeRequest {
  return {
    sessionId: input.sessionId,
    sessionKey: input.sessionKey,
    instructions: input.instructions,
    input: input.input,
    structuredOutputSchema: input.structuredOutputSchema,
    terminalToolName: input.terminalToolName,
    stream: input.stream ?? false,
    maxOutputTokens: input.maxOutputTokens,
    timeoutSeconds: input.timeoutMs
      ? Math.ceil(input.timeoutMs / 1000)
      : undefined,
  };
}

function isStartRunInput(
  input: StreamRunInput,
): input is Extract<StreamRunInput, { sessionId: string }> {
  return "sessionId" in input && "instructions" in input && "input" in input;
}

function buildRunRef(input: {
  sessionId: string;
  response: Record<string, unknown>;
  fallbackRunId?: string;
}): ProviderRunRef {
  const responseId = getResponseId(input.response);
  const runId = responseId ?? input.fallbackRunId ?? crypto.randomUUID();
  return {
    provider: OPENCLAW_PROVIDER,
    runId,
    nativeRunId: responseId,
    responseId,
    sessionId: input.sessionId,
    status: mapProviderRunStatus(input.response.status),
    raw: input.response,
  };
}

function buildRunSnapshot(input: {
  request?: BridgeRequest;
  runId: string;
  sessionId?: string;
  response: Record<string, unknown>;
}): ProviderRunSnapshot {
  const responseId = getResponseId(input.response);
  const status = mapProviderRunStatus(input.response.status);
  const outputText = extractOutputText(input.response);
  const error = input.response.error
    ? typeof input.response.error === "string"
      ? input.response.error
      : JSON.stringify(input.response.error)
    : null;
  const { toolCalls } = parseFunctionItems(input.response);
  return {
    provider: OPENCLAW_PROVIDER,
    runId: responseId ?? input.runId,
    nativeRunId: responseId,
    sessionId: input.sessionId ?? input.request?.sessionId,
    status: error ? "failed" : status,
    rawStatus:
      typeof input.response.status === "string" ? input.response.status : undefined,
    outputText,
    structuredPayload: input.request
      ? buildStructuredResult({
          sessionId: input.request.sessionId,
          runId: responseId,
          output: outputText,
          toolCalls,
          error,
          requestedToolName: input.request.terminalToolName ?? resolveRequestedFunctionToolName(input.request),
        })
      : undefined,
    usage: mapUsage(input.response),
    error,
    raw: input.response,
  };
}

function buildTerminalToolResponse(input: {
  request: BridgeRequest;
  toolCall: OpenClawToolCall;
  responseId?: string;
}): Record<string, unknown> {
  const id = input.responseId ?? `terminal-${crypto.randomUUID()}`;
  return {
    id,
    status: "completed",
    output: [
      {
        type: "function_call",
        id: input.toolCall.callId,
        call_id: input.toolCall.callId,
        name: input.toolCall.tool,
        arguments: JSON.stringify(input.toolCall.input),
      },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: `${input.toolCall.tool} accepted; current Chrona node run stopped.`,
          },
        ],
      },
    ],
  };
}

function isTerminalToolCall(request: BridgeRequest, event: OpenClawGatewayStreamEvent) {
  return Boolean(
    request.terminalToolName &&
    (event.type === "tool_call" || event.type === "tool_result") &&
    event.toolCall?.tool === request.terminalToolName,
  );
}

async function createOpenClawDump(input: {
  label: string;
  sessionId: string;
  url: string;
  request: BridgeRequest;
  body: unknown;
}) {
  if (!openClawDumpEnabled()) {
    return null;
  }

  const directory = openClawDumpDirectory();
  await mkdir(directory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = join(
    directory,
    `${timestamp}-${safeDebugSegment(input.label)}-${safeDebugSegment(input.sessionId)}.sse.log`,
  );
  const handle = await open(filePath, "a");
  await handle.appendFile(
    JSON.stringify({
      type: "meta",
      timestamp: new Date().toISOString(),
      label: input.label,
      sessionId: input.sessionId,
      url: input.url,
      request: input.request,
      body: input.body,
    }) + "\n",
  );

  return {
    filePath,
    async write(entry: unknown) {
      await handle.appendFile(JSON.stringify(entry) + "\n");
    },
    async close() {
      await handle.close();
    },
  };
}

async function* parseStreamingGatewayGenerator(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  dump?: Awaited<ReturnType<typeof createOpenClawDump>>,
): AsyncGenerator<{
  gatewayEventType: string;
  payload: Record<string, unknown>;
  streamEvent?: OpenClawGatewayStreamEvent;
}> {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";
  let chunkIndex = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      await dump?.write({
        type: "reader.done",
        timestamp: new Date().toISOString(),
      });
      break;
    }

    const chunk = decoder.decode(value, { stream: true });
    await dump?.write({
      type: "chunk",
      timestamp: new Date().toISOString(),
      index: chunkIndex++,
      byteLength: value.byteLength,
      text: chunk,
    });
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("event:")) {
        currentEventType = trimmed.slice(6).trim();
        continue;
      }
      if (!trimmed.startsWith("data:")) continue;

      const rawData = trimmed.slice(5).trim();
      if (!rawData) continue;
      if (rawData === "[DONE]") {
        await dump?.write({
          type: "done_marker",
          timestamp: new Date().toISOString(),
          event: currentEventType,
        });
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        await dump?.write({
          type: "parse_error",
          timestamp: new Date().toISOString(),
          event: currentEventType,
          data: rawData,
        });
        currentEventType = "";
        continue;
      }

      await dump?.write({
        type: "event",
        timestamp: new Date().toISOString(),
        event: currentEventType,
        data: parsed,
      });

      if (currentEventType === "response.output_text.delta") {
        const delta =
          typeof parsed.delta === "string"
            ? parsed.delta
            : typeof parsed.text === "string"
              ? parsed.text
              : "";
        if (delta) {
          yield {
            gatewayEventType: currentEventType,
            payload: parsed,
            streamEvent: { type: "text", data: delta },
          };
        }
        currentEventType = "";
        continue;
      }

      if (
        currentEventType === "response.output_item.added" ||
        currentEventType === "response.output_item.done"
      ) {
        const item = parsed.item;
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const toolCall = item as Record<string, unknown>;
          if (toolCall.type === "function_call") {
            yield {
              gatewayEventType: currentEventType,
              payload: parsed,
              streamEvent: {
                type: "tool_call",
                data: JSON.stringify(toolCall),
                toolCall: {
                  tool: (toolCall.name as string) ?? "unknown",
                  callId: (toolCall.call_id as string) ?? `${Date.now()}`,
                  input: parseToolArguments(toolCall.arguments),
                  status: "completed",
                },
              },
            };
          }
        }
        currentEventType = "";
        continue;
      }

      if (currentEventType === "response.completed") {
        yield {
          gatewayEventType: currentEventType,
          payload: parsed,
        };
        const response = parsed.response;
        if (
          response &&
          typeof response === "object" &&
          !Array.isArray(response)
        ) {
          for (const item of extractFunctionCallsFromOutput(
            (response as Record<string, unknown>).output,
          )) {
            if (item.type !== "function_call") continue;
            yield {
              gatewayEventType: currentEventType,
              payload: parsed,
              streamEvent: {
                type: "tool_call",
                data: JSON.stringify(item),
                toolCall: {
                  tool: (item.name as string) ?? "unknown",
                  callId: (item.call_id as string) ?? `${Date.now()}`,
                  input: parseToolArguments(item.arguments),
                  status: "completed",
                },
              },
            };
          }
        }
        currentEventType = "";
        continue;
      }

      yield {
        gatewayEventType: currentEventType,
        payload: parsed,
      };

      currentEventType = "";
    }
  }
}

export class OpenClawClient implements AgentProviderClient {
  readonly provider = OPENCLAW_PROVIDER;

  private env: BridgeEnvironment;

  constructor(config: OpenClawClientConfig) {
    this.env = {
      gatewayHttpUrl: normalizeGatewayHttpUrl(config.gatewayUrl),
      gatewayToken: config.gatewayToken ?? "",
      agentId: "main",
      model: config.model?.trim() || OPENCLAW_DEFAULT_MODEL,
    };
  }

  getCapabilities(): ProviderCapabilities {
    return OPENCLAW_CAPABILITIES;
  }

  async checkHealth(input?: HealthCheckInput): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const ok = await checkGatewayAvailable({
        ...this.env,
        gatewayHttpUrl: this.env.gatewayHttpUrl,
      });
      return {
        provider: this.provider,
        ok,
        checkedAt: isoNow(),
        latencyMs: Date.now() - startedAt,
        message: ok ? "Gateway is reachable" : "Gateway health check failed",
      };
    } catch (error) {
      return {
        provider: this.provider,
        ok: false,
        checkedAt: isoNow(),
        latencyMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : "Health check failed",
      };
    } finally {
      void input;
    }
  }

  async createSession(input?: CreateSessionInput): Promise<ProviderSessionRef> {
    const sessionId = input?.sessionKey?.trim() || crypto.randomUUID();
    return {
      provider: this.provider,
      sessionId,
      nativeSessionId: sessionId,
      sessionKey: input?.sessionKey,
      createdAt: isoNow(),
    };
  }

  private async *executeStreamingRequest(
    input: OpenClawGatewayRunRequest,
    state: { finalResponse: Record<string, unknown> },
  ): AsyncGenerator<OpenClawGatewayStreamEvent> {
    const sessionId = input.request.sessionId;
    const body = buildGatewayBody(input.request, this.env);
    const headers = gatewayHeaders(this.env, input.request);
    const signal = timeoutSignal({
      signal: input.signal,
      timeoutSeconds: input.request.timeoutSeconds,
    });

    const url = `${this.env.gatewayHttpUrl}/v1/responses`;
    const dump = await createOpenClawDump({
      label: sessionId,
      sessionId,
      url,
      request: input.request,
      body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    await dump?.write({
      type: "response",
      timestamp: new Date().toISOString(),
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      await dump?.write({
        type: "error_body",
        timestamp: new Date().toISOString(),
        text: errText,
      });
      await dump?.close();
      throw new Error(
        `[openclaw] Gateway call failed (${res.status}): ${errText.slice(0, 500)}`,
      );
    }

    const reader = res.body?.getReader();
    if (!reader) {
      await dump?.write({
        type: "missing_body",
        timestamp: new Date().toISOString(),
      });
      await dump?.close();
      throw new Error("[openclaw] Stream response missing body");
    }

    state.finalResponse = {};

    try {
      for await (const event of parseStreamingGatewayGenerator(reader, dump)) {
        if (
          (event.gatewayEventType === "response.completed" ||
            event.gatewayEventType === "response.failed") &&
          event.payload.response &&
          typeof event.payload.response === "object" &&
          !Array.isArray(event.payload.response)
        ) {
          state.finalResponse = event.payload.response as Record<
            string,
            unknown
          >;
        }
        if (event.streamEvent) {
          yield event.streamEvent;
          if (isTerminalToolCall(input.request, event.streamEvent)) {
            state.finalResponse = buildTerminalToolResponse({
              request: input.request,
              toolCall: event.streamEvent.toolCall!,
            });
            await dump?.write({
              type: "terminal_tool_stop",
              timestamp: new Date().toISOString(),
              tool: event.streamEvent.toolCall?.tool,
            });
            return;
          }
        }
      }
    } finally {
      await dump?.write({ type: "close", timestamp: new Date().toISOString() });
      await dump?.close();
    }

    const responseId =
      typeof state.finalResponse.id === "string"
        ? state.finalResponse.id
        : undefined;
    const { toolCalls, toolCallOutputs } = parseFunctionItems(
      state.finalResponse,
    );
    commitGatewayTurnState({
      request: input.request,
      responseId,
      toolCalls,
      toolCallOutputs,
    });
  }

  async startRun(input: StartRunInput): Promise<ProviderRunRef> {
    const request: BridgeRequest = { ...buildBridgeRequest(input), stream: true };
    const state = { finalResponse: {} as Record<string, unknown> };
    for await (const _event of this.executeStreamingRequest(
      {
        request,
        signal: input.signal,
      },
      state,
    )) {
      void _event;
    }
    return buildRunRef({
      sessionId: request.sessionId,
      response: state.finalResponse,
    });
  }

  async *streamRun(input: StreamRunInput): AsyncIterable<ProviderRunEvent> {
    if (!isStartRunInput(input)) {
      yield {
        type: "run_failed",
        error: "OpenClaw streamRun requires sessionId, instructions, and input",
      };
      return;
    }

    const request: BridgeRequest = { ...buildBridgeRequest(input), stream: true };
    const state = { finalResponse: {} as Record<string, unknown> };
    try {
      for await (const event of this.executeStreamingRequest(
        {
          request,
          signal: input.signal,
        },
        state,
      )) {
        if (event.type === "text") {
          yield { type: "text_delta", text: event.data };
        } else if (event.type === "tool_call" && event.toolCall) {
          yield {
            type: "tool_call",
            tool: event.toolCall.tool,
            callId: event.toolCall.callId,
            input: event.toolCall.input,
            status: event.toolCall.status,
          };
        } else if (event.type === "tool_result") {
          yield {
            type: "tool_result",
            tool: event.toolCall?.tool,
            callId: event.toolCall?.callId,
            result: event.data,
          };
        } else if (event.type === "error") {
          yield { type: "run_failed", error: event.data };
          return;
        }
      }
      const snapshot = buildRunSnapshot({
        request,
        runId: getResponseId(state.finalResponse) ?? crypto.randomUUID(),
        response: state.finalResponse,
      });
      if (snapshot.error) {
        yield {
          type: "run_failed",
          run: {
            provider: this.provider,
            runId: snapshot.runId,
            nativeRunId: snapshot.nativeRunId,
            responseId: snapshot.nativeRunId,
            sessionId: snapshot.sessionId ?? request.sessionId,
            status: snapshot.status,
            raw: snapshot.raw,
          },
          error: snapshot.error,
          raw: snapshot.raw,
        };
        return;
      }
      yield {
        type: "run_completed",
        run: {
          provider: this.provider,
          runId: snapshot.runId,
          nativeRunId: snapshot.nativeRunId,
          responseId: snapshot.nativeRunId,
          sessionId: snapshot.sessionId ?? request.sessionId,
          status: snapshot.status,
          raw: snapshot.raw,
        },
        outputText: snapshot.outputText,
        structuredPayload: snapshot.structuredPayload,
        usage: snapshot.usage,
        raw: snapshot.raw,
      };
    } catch (error) {
      yield {
        type: "run_failed",
        error: error instanceof Error ? error.message : "OpenClaw run failed",
      };
    }
  }

  async getRun(input: GetRunInput): Promise<ProviderRunSnapshot> {
    const res = await fetch(
      `${this.env.gatewayHttpUrl}/v1/responses/${encodeURIComponent(input.runId)}`,
      {
        method: "GET",
        headers: gatewayHeaders(this.env),
        signal: timeoutSignal({ signal: input.signal, timeoutMs: 15_000 }),
      },
    );
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `[openclaw] Run lookup failed (${res.status}): ${text.slice(0, 500)}`,
      );
    }
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("[openclaw] Run lookup returned invalid JSON");
    }
    return buildRunSnapshot({
      runId: input.runId,
      sessionId: input.sessionId,
      response: parsed as Record<string, unknown>,
    });
  }

  async cancelRun(input: CancelRunInput): Promise<ProviderRunSnapshot> {
    const res = await fetch(
      `${this.env.gatewayHttpUrl}/v1/responses/${encodeURIComponent(input.runId)}/cancel`,
      {
        method: "POST",
        headers: gatewayHeaders(this.env),
        signal: timeoutSignal({ signal: input.signal, timeoutMs: 15_000 }),
      },
    );
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(
        `[openclaw] Run cancellation failed (${res.status}): ${text.slice(0, 500)}`,
      );
    }
    const parsed = text ? (JSON.parse(text) as unknown) : { id: input.runId, status: "cancelled" };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("[openclaw] Run cancellation returned invalid JSON");
    }
    return buildRunSnapshot({
      runId: input.runId,
      sessionId: input.sessionId,
      response: parsed as Record<string, unknown>,
    });
  }
}

export async function createOpenClawClient(
  config?: OpenClawConnectionConfig,
): Promise<OpenClawClient> {
  if (!config?.bridgeUrl?.trim()) {
    throw new Error("OpenClaw bridgeUrl is required");
  }

  return new OpenClawClient({
    gatewayUrl: config.bridgeUrl,
    gatewayToken: config.bridgeToken,
  });
}

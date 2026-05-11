import { OPENCLAW_DEFAULT_MODEL } from "@chrona/contracts";
import {
  buildGatewayBody,
  commitGatewayTurnState,
  gatewayHeaders,
  mapUsage,
  normalizeGatewayHttpUrl,
  parseFunctionItems,
  resolveRequestedFunctionToolName,
} from "./gateway";
import { buildStructuredResult, extractOutputText } from "./feature-contracts";
import type {
  BridgeResponse,
  BridgeEnvironment,
  BridgeRequest,
  OpenClawClientConfig,
  OpenClawStreamEvent,
} from "./types";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

export type OpenClawResponseRequest = {
  request: BridgeRequest;
  signal?: AbortSignal;
};

export type OpenClawConnectionConfig = {
  bridgeUrl?: string;
  bridgeToken?: string;
  timeoutSeconds?: number;
  mode?: "live" | "mock";
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
  streamEvent?: OpenClawStreamEvent;
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

export class OpenClawClient {
  private env: BridgeEnvironment;

  constructor(config: OpenClawClientConfig) {
    this.env = {
      gatewayHttpUrl: normalizeGatewayHttpUrl(config.gatewayUrl),
      gatewayToken: config.gatewayToken ?? "",
      agentId: "main",
      model: config.model?.trim() || OPENCLAW_DEFAULT_MODEL,
    };
  }

  private async *executeStreamingRequest(
    input: OpenClawResponseRequest,
    state: { finalResponse: Record<string, unknown> },
  ): AsyncGenerator<OpenClawStreamEvent> {
    const sessionId = input.request.sessionId;
    const body = buildGatewayBody(input.request, this.env);
    const headers = gatewayHeaders(this.env, input.request);
    const timeoutMs = ((input.request.timeoutSeconds ?? 300) + 15) * 1000;
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

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

  async execute(input: OpenClawResponseRequest): Promise<BridgeResponse> {
    const startedAt = Date.now();
    const request: BridgeRequest = {
      ...input.request,
      stream: true,
    };
    const state = { finalResponse: {} as Record<string, unknown> };
    for await (const _event of this.executeStreamingRequest(
      {
        ...input,
        request,
      },
      state,
    )) {
      void _event;
    }
    const finalResponse = state.finalResponse;
    const responseId =
      typeof finalResponse.id === "string" ? finalResponse.id : undefined;
    const { toolCalls } = parseFunctionItems(finalResponse);

    const outputText = extractOutputText(finalResponse);
    const error = finalResponse.error
      ? JSON.stringify(finalResponse.error)
      : Object.keys(finalResponse).length === 0
        ? "response.completed event missing response payload"
        : null;

    return {
      sessionId: request.sessionId,
      responseId,
      responseStatus:
        typeof finalResponse.status === "string"
          ? finalResponse.status
          : undefined,
      runId: responseId,
      output: outputText,
      usage: mapUsage(finalResponse),
      error,
      durationMs: Date.now() - startedAt,
      structured: buildStructuredResult({
        sessionId: request.sessionId,
        runId: responseId,
        output: outputText,
        toolCalls,
        error,
        requestedToolName: resolveRequestedFunctionToolName(request),
      }),
      feature: null,
    };
  }

  async *stream(
    input: OpenClawResponseRequest,
  ): AsyncGenerator<OpenClawStreamEvent> {
    const request: BridgeRequest = {
      ...input.request,
      stream: true,
    };
    yield* this.executeStreamingRequest(
      {
        ...input,
        request,
      },
      { finalResponse: {} },
    );
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

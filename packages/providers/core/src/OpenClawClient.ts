import {
  buildGatewayBody,
  checkGatewayAvailable as checkGateway,
  buildFeatureResultFromResponse,
  gatewayHeaders,
  normalizeGatewayHttpUrl,
  type BridgeEnvironment,
  type ToolCallInfo,
} from "@chrona/openclaw";
import type { PreparedAiFeatureSpec } from "@chrona/contracts";
import {
  ProviderClient,
  type ProviderConfig,
  type ProviderFeature,
  type ProviderResponse,
  type StreamEvent,
} from "./ProviderClient";

type GatewayRoute =
  | { kind: "feature"; feature: ProviderFeature; stream: boolean }
  | { kind: "execution"; stream: boolean };

type GatewayRequestInput = {
  sessionKey: string;
  timeout: number;
  instructions: string;
  inputText?: string;
  featureSpec?: PreparedAiFeatureSpec;
  input: Record<string, unknown>;
};

type RawGatewayEvent = Record<string, unknown>;

type ParsedGatewayResponse = {
  output: string;
  toolCalls: ToolCallInfo[];
  events: RawGatewayEvent[];
};

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>;
  return {};
}

function toToolCallInfo(toolCall: Record<string, unknown>): ToolCallInfo {
  return {
    tool: (toolCall.name as string) ?? "unknown",
    callId: (toolCall.call_id as string) ?? `${Date.now()}`,
    input: parseToolArguments(toolCall.arguments),
    status: "completed",
  };
}

function buildRoute(
  kind: "feature" | "execution",
  feature: ProviderFeature | undefined,
  stream: boolean,
): GatewayRoute {
  return kind === "feature" && feature
    ? { kind: "feature", feature, stream }
    : { kind: "execution", stream };
}

function normalizeGatewayRequestInput(
  input: Record<string, unknown>,
): GatewayRequestInput {
  const sessionKey = (input.sessionKey as string) ?? `openclaw-${Date.now()}`;
  const timeout = (input.timeout as number) ?? 300;
  const instructions = (input.instructions as string) ?? "";
  const {
    sessionKey: _sk,
    instructions: _in,
    inputText,
    featureSpec,
    timeout: _to,
    ...featureInput
  } = input;

  return {
    sessionKey,
    timeout,
    instructions,
    inputText:
      typeof inputText === "string" && inputText.trim() ? inputText : undefined,
    featureSpec:
      featureSpec && typeof featureSpec === "object"
        ? (featureSpec as PreparedAiFeatureSpec)
        : undefined,
    input:
      Object.keys(featureInput).length > 0
        ? featureInput
        : { prompt: instructions },
  };
}

function buildBridgeResponse(params: {
  sessionId: string;
  feature: ProviderFeature | undefined;
  parsed: ParsedGatewayResponse;
  featureSpec?: PreparedAiFeatureSpec;
}): ProviderResponse {
  const built = buildFeatureResultFromResponse(
    params.feature ?? "generate_plan",
    params.parsed.output,
    params.parsed.toolCalls,
    params.featureSpec,
  );

  return {
    sessionId: params.sessionId,
    output: built.error ? "" : params.parsed.output,
    error: built.error,
    toolCalls: built.featureResult ? params.parsed.toolCalls : [],
    usage: null,
    durationMs: 0,
    structured: null,
    feature: built.featureResult,
  };
}

async function parseStreamingGatewayResponse(
  res: Response,
): Promise<ParsedGatewayResponse> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("[openclaw] Stream response missing body");
  }

  const decoder = new TextDecoder();
  const events: RawGatewayEvent[] = [];
  const toolCalls: ToolCallInfo[] = [];
  let output = "";
  let buffer = "";
  let currentEventType = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
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
      if (!rawData || rawData === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        currentEventType = "";
        continue;
      }

      if (currentEventType === "response.output_text.delta") {
        const delta =
          typeof parsed.delta === "string"
            ? parsed.delta
            : typeof parsed.text === "string"
              ? parsed.text
              : "";
        if (delta) {
          output += delta;
          events.push({ delta });
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
            events.push({ function_call: toolCall });
            toolCalls.push(toToolCallInfo(toolCall));
          }
        }
      }

      currentEventType = "";
    }
  }

  return { output, toolCalls, events };
}

async function* parseStreamingGatewayGenerator(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEventType = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
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
      if (!rawData || rawData === "[DONE]") continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        currentEventType = "";
        continue;
      }

      if (currentEventType === "response.output_text.delta") {
        const delta =
          typeof parsed.delta === "string"
            ? parsed.delta
            : typeof parsed.text === "string"
              ? parsed.text
              : "";
        if (delta) {
          yield { type: "text", data: delta };
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
              type: "tool_call",
              data: JSON.stringify(toolCall),
              toolCall: {
                tool: (toolCall.name as string) ?? "unknown",
                callId: (toolCall.call_id as string) ?? `${Date.now()}`,
                input: parseToolArguments(toolCall.arguments),
                status: "completed" as const,
              },
            };
          }
        }
      }

      currentEventType = "";
    }
  }
}

async function parseJsonGatewayResponse(
  res: Response,
): Promise<ParsedGatewayResponse> {
  const responseText = await res.text();
  let responseJson: Record<string, unknown>;
  try {
    responseJson = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `[openclaw] Invalid JSON from gateway: ${responseText.slice(0, 200)}`,
    );
  }

  const output =
    (responseJson.output_text as string) ??
    (typeof responseJson.output === "string" ? responseJson.output : "") ??
    "";
  const events: RawGatewayEvent[] = [responseJson];
  const toolCalls: ToolCallInfo[] = [];
  const responseToolCalls = responseJson.output as
    | Array<Record<string, unknown>>
    | undefined;

  if (responseToolCalls) {
    for (const toolCall of responseToolCalls) {
      if (toolCall.type !== "function_call") continue;
      toolCalls.push(toToolCallInfo(toolCall));
    }
  }

  return { output, toolCalls, events };
}

export class OpenClawClient extends ProviderClient {
  private env: BridgeEnvironment;

  constructor(config: ProviderConfig) {
    super(config);
    this.env = {
      gatewayHttpUrl: normalizeGatewayHttpUrl(config.gatewayUrl),
      gatewayToken: config.gatewayToken ?? "",
      agentId: "main",
      model: config.model,
    };
  }

  async checkHealth(): Promise<boolean> {
    return checkGateway(this.env);
  }

  async executeFeature(
    feature: ProviderFeature,
    input: {
      sessionKey?: string;
      instructions?: string;
      timeout?: number;
      [key: string]: unknown;
    },
  ): Promise<ProviderResponse> {
    return this.executeGateway("feature", feature, false, input);
  }

  async *executeFeatureStream(
    feature: ProviderFeature,
    input: {
      sessionKey?: string;
      instructions?: string;
      timeout?: number;
      [key: string]: unknown;
    },
  ): AsyncGenerator<StreamEvent> {
    const route = buildRoute("feature", feature, true);
    const request = normalizeGatewayRequestInput(input);
    const sessionId = `${request.sessionKey}-${Date.now()}`;
    const body = buildGatewayBody(
      route,
      request as unknown as Parameters<typeof buildGatewayBody>[1],
      sessionId,
      this.env,
    );
    const headers = gatewayHeaders(
      this.env,
      request as unknown as Parameters<typeof gatewayHeaders>[1],
    );
    const timeoutMs = (request.timeout + 15) * 1000;

    const res = await fetch(`${this.env.gatewayHttpUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `[openclaw] Gateway call failed (${res.status}): ${errText.slice(0, 500)}`,
      );
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("[openclaw] Stream response missing body");
    }

    yield* parseStreamingGatewayGenerator(reader);
  }

  async executeTask(input: {
    sessionKey?: string;
    instructions: string;
    prompt?: string;
    timeout?: number;
    [key: string]: unknown;
  }): Promise<ProviderResponse> {
    return this.executeGateway(
      "execution",
      undefined as unknown as ProviderFeature,
      false,
      input,
    );
  }

  private async executeGateway(
    kind: "feature" | "execution",
    feature: ProviderFeature | undefined,
    stream: boolean,
    input: Record<string, unknown>,
  ): Promise<ProviderResponse> {
    const { response } = await this.executeGatewayRaw(
      kind,
      feature,
      stream,
      input,
    );
    return response;
  }

  private async executeGatewayRaw(
    kind: "feature" | "execution",
    feature: ProviderFeature | undefined,
    stream: boolean,
    input: Record<string, unknown>,
  ): Promise<{
    response: ProviderResponse;
    events: Array<Record<string, unknown>>;
  }> {
    const route = buildRoute(kind, feature, stream);
    const request = normalizeGatewayRequestInput(input);
    const sessionId = `${request.sessionKey}-${Date.now()}`;
    const body = buildGatewayBody(
      route,
      request as unknown as Parameters<typeof buildGatewayBody>[1],
      sessionId,
      this.env,
    );
    const headers = gatewayHeaders(
      this.env,
      request as unknown as Parameters<typeof gatewayHeaders>[1],
    );
    const timeoutMs = (request.timeout + 15) * 1000;

    const res = await fetch(`${this.env.gatewayHttpUrl}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `[openclaw] Gateway call failed (${res.status}): ${errText.slice(0, 500)}`,
      );
    }

    const parsed = stream
      ? await parseStreamingGatewayResponse(res)
      : await parseJsonGatewayResponse(res);

    return {
      response: buildBridgeResponse({
        sessionId,
        feature,
        parsed,
        featureSpec: request.featureSpec,
      }),
      events: parsed.events,
    };
  }
}

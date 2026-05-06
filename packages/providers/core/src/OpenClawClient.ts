import {
  buildGatewayBody,
  checkGatewayAvailable as checkGateway,
  gatewayHeaders,
  normalizeGatewayHttpUrl,
  type BridgeEnvironment,
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
    throw new Error(
      "executeFeature is not supported, use executeFeatureStream instead: " +
        JSON.stringify({ feature, input }),
    );
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
    throw new Error(
      "this method is not supported, use executeFeatureStream instead: " +
        JSON.stringify(input),
    );
  }
}

/**
 * AI Features — Provider dispatch implementations (OpenClaw + LLM).
 */

import type {
  AiClientRecord,
  AiFeature,
  OpenClawClientConfig,
  LLMClientConfig,
} from "./types";
import { AiClientError } from "./types";
import { SYSTEM_PROMPTS } from "./prompts";
import {
  coerceStructuredResult,
  parseTextJsonWithFallback,
  type OpenClawCallResult,
  type OpenClawStructuredMode,
} from "./structured";
import type { BridgeResponse } from "@chrona/openclaw-integration/transport/bridge-types";

interface LLMChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

function buildOpenClawSessionId(feature: AiFeature, scope: string): string {
  const sanitize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "default";

  return `ai-${sanitize(feature)}-${sanitize(scope)}`;
}

export function extractJSON<T>(raw: string, clientType: string): T {
  return parseTextJsonWithFallback<T>(raw, clientType);
}

async function fetchOpenClawBridge(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  userMessage: string,
  mode: OpenClawStructuredMode,
): Promise<OpenClawCallResult> {
  const timeout = config.timeoutSeconds ?? 120;
  const sessionId = buildOpenClawSessionId(feature, scope);

  const res = await fetch(`${config.bridgeUrl}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      message: userMessage,
      systemPrompt: SYSTEM_PROMPTS[feature],
      timeout,
    }),
    signal: AbortSignal.timeout((timeout + 15) * 1000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(
      `Bridge returned ${res.status}: ${errText.slice(0, 200)}`,
      "openclaw",
      "internal",
    );
  }

  const bridge = (await res.json()) as BridgeResponse;
  if (bridge.error) {
    throw new AiClientError(bridge.error, "openclaw", "internal");
  }

  return coerceStructuredResult(bridge, mode);
}

export async function openclawCall(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  userMessage: string,
): Promise<string> {
  const result = await fetchOpenClawBridge(config, feature, scope, userMessage, "text");
  return result.text;
}

export async function openclawStructuredCall<T = unknown>(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  userMessage: string,
): Promise<OpenClawCallResult<T>> {
  const result = await fetchOpenClawBridge(config, feature, scope, userMessage, "structured");
  return {
    ...result,
    structured: result.structured
      ? { ...result.structured, parsed: (result.structured.parsed ?? null) as T | null }
      : null,
  };
}

export async function openclawHealthCheck(
  config: OpenClawClientConfig,
): Promise<boolean> {
  try {
    const res = await fetch(`${config.bridgeUrl}/v1/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}

export async function llmCall(
  config: LLMClientConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { jsonMode?: boolean; temperature?: number; maxTokens?: number },
): Promise<string> {
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? config.temperature ?? 0.7,
  };

  if (options?.maxTokens) body.max_tokens = options.maxTokens;
  if (options?.jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(
      `LLM returned ${res.status}: ${errText.slice(0, 200)}`,
      "llm",
      "internal",
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new AiClientError("No response body for streaming", "llm", "internal");
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) chunks.push(content);
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return chunks.join("");
}

export function llmHealthCheck(config: LLMClientConfig): boolean {
  return Boolean(config.baseUrl && config.apiKey);
}

export async function dispatch(
  client: AiClientRecord,
  feature: AiFeature,
  userMessage: string,
  scope = "default",
): Promise<string> {
  if (client.type === "openclaw") {
    return openclawCall(
      client.config as OpenClawClientConfig,
      feature,
      scope,
      userMessage,
    );
  }
  return llmCall(
    client.config as LLMClientConfig,
    SYSTEM_PROMPTS[feature],
    userMessage,
    { jsonMode: feature !== "chat" },
  );
}

export async function dispatchStructured<T = unknown>(
  client: AiClientRecord,
  feature: AiFeature,
  userMessage: string,
  scope = "default",
): Promise<OpenClawCallResult<T>> {
  if (client.type === "openclaw") {
    return openclawStructuredCall<T>(
      client.config as OpenClawClientConfig,
      feature,
      scope,
      userMessage,
    );
  }

  const text = await llmCall(
    client.config as LLMClientConfig,
    SYSTEM_PROMPTS[feature],
    userMessage,
    { jsonMode: feature !== "chat" },
  );

  return {
    mode: "structured",
    text,
    structured: null,
    bridge: {
      sessionId: buildOpenClawSessionId(feature, scope),
      runId: undefined,
      output: text,
      toolCalls: [],
      usage: null,
      error: null,
      durationMs: 0,
      structured: null,
    },
  };
}

export async function checkClientHealth(
  client: AiClientRecord,
): Promise<boolean> {
  if (!client.enabled) return false;
  if (client.type === "openclaw") {
    return openclawHealthCheck(client.config as OpenClawClientConfig);
  }
  return llmHealthCheck(client.config as LLMClientConfig);
}







/**
 * AI Client — Provider implementations (OpenClaw + LLM).
 */

import {
  type AiClientRecord,
  type AiFeature,
  type OpenClawClientConfig,
  type LLMClientConfig,
  AiClientError,
} from "./types";
import { SYSTEM_PROMPTS } from "./prompts";

// ── Internal types ──

interface BridgeChatResponse {
  sessionId: string;
  output: string;
  toolCalls: Array<{
    tool: string;
    callId: string;
    input: Record<string, unknown>;
    result?: string;
    status: string;
  }>;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
  durationMs: number;
}

interface LLMChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── JSON Parsing Utility ──

export function extractJSON<T>(raw: string, clientType: string): T {
  const jsonMatch =
    raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? raw;
  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    throw new AiClientError(
      `Failed to parse JSON: ${raw.slice(0, 200)}`,
      clientType,
      "invalid_response",
    );
  }
}

// ── OpenClaw Client ──

export async function openclawCall(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  userMessage: string,
): Promise<string> {
  const timeout = config.timeoutSeconds ?? 120;
  const sessionId = `ai::${feature}::${scope}`;

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

  const result = (await res.json()) as BridgeChatResponse;
  if (result.error) {
    throw new AiClientError(result.error, "openclaw", "internal");
  }
  return result.output;
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

// ── LLM Client ──

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
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(
      `LLM returned ${res.status}: ${errText.slice(0, 200)}`,
      "llm",
      "internal",
    );
  }

  const data = (await res.json()) as LLMChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

export function llmHealthCheck(config: LLMClientConfig): boolean {
  return Boolean(config.baseUrl && config.apiKey);
}

// ── Unified Dispatch ──

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

// ── Health Check ──

export async function checkClientHealth(
  client: AiClientRecord,
): Promise<boolean> {
  if (!client.enabled) return false;
  if (client.type === "openclaw") {
    return openclawHealthCheck(client.config as OpenClawClientConfig);
  }
  return llmHealthCheck(client.config as LLMClientConfig);
}

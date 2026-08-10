/**
 * AI Features — Canonical feature implementations.
 */

import { randomUUID } from "node:crypto";

import type {
  SmartSuggestResponse,
  SmartSuggestion,
  ChatRequest,
  ChatResponse,
  StructuredDebugInfo,
} from "@chrona/contracts";
import { AiClientError } from "@chrona/contracts";
import { parseJsonServerEventStream } from "@chrona/providers-foundation";
import { dispatch, extractJSON } from "./providers";
import type { EngineAiClient } from "./runtime/client-registry";
import { aiClientRegistry } from "./runtime/client-registry";

function trimTrailingSlashes(value: string) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

function ensureObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiClientError(
      `${context} must be an object`,
      "hermes",
      "invalid_response",
    );
  }
  return value as Record<string, unknown>;
}

export function normalizeSuggestResponse(input: {
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | null;
}): SmartSuggestResponse {
  const parsed = ensureObject(input.parsed, "suggest result");
  return {
    suggestions: (
      (parsed.suggestions as Array<Partial<SmartSuggestion>> | undefined) ?? []
    )
      .filter((suggestion) => suggestion.title)
      .map((suggestion) => ({
        title: suggestion.title!,
        description: suggestion.description ?? "",
        priority: suggestion.priority ?? "Medium",
        estimatedMinutes: suggestion.estimatedMinutes ?? 30,
        tags: suggestion.tags ?? [],
        suggestedSlot: suggestion.suggestedSlot,
      })),
    source: input.source,
    requestId: randomUUID(),
    structured: input.structured ?? undefined,
  };
}

export async function chat(
  client: EngineAiClient,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (client.providerClient) {
    if (request.jsonMode) {
      const content = await dispatch(client, "chat", request, "chat");
      return {
        content,
        parsed: extractJSON(content) as unknown,
        source: client.record.type,
      };
    }

    const raw = await dispatch(client, "chat", request, "chat");
    return { content: raw, source: client.record.type };
  }

  const llmClient = aiClientRegistry.requireLlmClient(client);
  const config = llmClient.record.config;
  const model = config.model ?? "gpt-4o-mini";
  const url = `${trimTrailingSlashes(config.baseUrl)}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: request.messages,
    temperature: request.temperature ?? config.temperature ?? 0.7,
  };
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  if (request.jsonMode) body.response_format = { type: "json_object" };

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

  if (!res.body) {
    throw new AiClientError(
      "No response body for streaming",
      "llm",
      "internal",
    );
  }

  const contentChunks: string[] = [];
  try {
    for await (const value of parseJsonServerEventStream(res.body, { doneSentinel: "[DONE]" })) {
      const parsed = value as { choices?: Array<{ delta?: { content?: string } }> };
      const content = parsed.choices?.[0]?.delta?.content;
      if (content) contentChunks.push(content);
    }
  } catch (error) {
    throw new AiClientError(
      error instanceof Error ? error.message : "LLM event stream failed",
      "llm",
      "invalid_response",
    );
  }

  const content = contentChunks.join("");
  if (request.jsonMode) {
    const parsed = extractJSON(content) as unknown;
    return { content, parsed, source: client.record.type };
  }
  return { content, source: client.record.type };
}

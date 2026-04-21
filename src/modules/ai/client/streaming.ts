/**
 * AI Client — Streaming support (OpenClaw SSE + LLM SSE).
 */

import type {
  AiClientRecord,
  AiFeature,
  OpenClawClientConfig,
  LLMClientConfig,
  SmartSuggestRequest,
  StreamEvent,
} from "./types";
import type { StructuredAgentResult } from "../../../../packages/runtime-client/src/openclaw/structured-result";
import { SYSTEM_PROMPTS } from "./prompts";
import { buildSuggestMessage } from "./features";
import { openclawCall } from "./providers";

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

/**
 * Stream from OpenClaw CLI Bridge.
 * The bridge exposes /v1/chat/stream (SSE) alongside the blocking /v1/chat.
 * Falls back to blocking call if stream endpoint is unavailable.
 */
export async function* openclawStream(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  userMessage: string,
): AsyncGenerator<StreamEvent> {
  const timeout = config.timeoutSeconds ?? 120;
  const sessionId = buildOpenClawSessionId(feature, scope);

  yield { type: "status", message: "正在连接 AI 服务..." };

  try {
    const res = await fetch(`${config.bridgeUrl}/v1/chat/stream`, {
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

    if (res.ok && res.body) {
      yield { type: "status", message: "AI 正在思考..." };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finalStructured: StreamEvent extends { type: "done"; structured?: infer S } ? S : never;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
            continue;
          }

          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          try {
            const evt = JSON.parse(raw) as {
              type?: string;
              text?: string;
              tool?: string;
              input?: Record<string, unknown>;
              result?: string;
              error?: string;
              output?: string;
              structured?: StreamEvent extends { type: "done"; structured?: infer S } ? S : never;
            };

            if (eventType === "done") {
              fullText = typeof evt.output === "string" ? evt.output : fullText;
              finalStructured = evt.structured;
              yield { type: "done", text: fullText, structured: finalStructured ?? null };
              return;
            }

            if (evt.type === "tool_use" && evt.tool) {
              yield { type: "tool_call", tool: evt.tool, input: evt.input ?? {} };
            } else if (evt.type === "tool_result" && evt.tool) {
              yield { type: "tool_result", tool: evt.tool, result: evt.text ?? evt.result ?? "" };
            } else if (evt.type === "error") {
              yield { type: "error", message: evt.error ?? evt.text ?? "Unknown error" };
              return;
            } else if (evt.type === "text" && evt.text) {
              fullText += evt.text;
              yield { type: "partial", text: evt.text };
            }
          } catch {
            // skip unparseable lines
          }
          eventType = "";
        }
      }
      yield { type: "done", text: fullText, structured: finalStructured ?? null };
      return;
    }
  } catch {
    // Stream endpoint not available, fall back to blocking
  }

  yield { type: "status", message: "AI 正在生成建议..." };
  try {
    const text = await openclawCall(config, feature, scope, userMessage);
    yield { type: "partial", text };
    yield { type: "done", text, structured: null };
  } catch (e) {
    yield { type: "error", message: e instanceof Error ? e.message : "Unknown error" };
  }
}

/**
 * Stream from OpenAI-compatible LLM API (SSE streaming).
 */
export async function* llmStream(
  config: LLMClientConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { jsonMode?: boolean; temperature?: number; maxTokens?: number },
): AsyncGenerator<StreamEvent> {
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  yield { type: "status", message: "正在连接 LLM..." };

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? config.temperature ?? 0.7,
    stream: true,
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
    yield {
      type: "error",
      message: `LLM returned ${res.status}: ${errText.slice(0, 200)}`,
    };
    return;
  }

  if (!res.body) {
    yield { type: "error", message: "No response body" };
    return;
  }

  yield { type: "status", message: "AI 正在生成..." };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") {
        yield { type: "done", text: fullText, structured: null };
        return;
      }
      try {
        const chunk = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          fullText += content;
          yield { type: "partial", text: content };
        }
      } catch {
        // skip
      }
    }
  }
  yield { type: "done", text: fullText, structured: null };
}

/**
 * Unified streaming dispatch.
 */
export function dispatchStream(
  client: AiClientRecord,
  feature: AiFeature,
  userMessage: string,
  scope = "default",
): AsyncGenerator<StreamEvent> {
  if (client.type === "openclaw") {
    return openclawStream(
      client.config as OpenClawClientConfig,
      feature,
      scope,
      userMessage,
    );
  }
  return llmStream(
    client.config as LLMClientConfig,
    SYSTEM_PROMPTS[feature],
    userMessage,
    { jsonMode: feature !== "chat" },
  );
}

/**
 * Stream suggest — yields StreamEvents including parsed suggestions at the end.
 */
export async function* suggestStream(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): AsyncGenerator<StreamEvent> {
  const gen = dispatchStream(
    client,
    "suggest",
    buildSuggestMessage(request),
    request.workspaceId ?? "default",
  );

  for await (const event of gen) {
    yield event;
  }
}

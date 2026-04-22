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
  GenerateTaskPlanRequest,
  GenerateTaskPlanResponse,
} from "./types";
import type { StructuredAgentResult } from "../../../../packages/runtime-client/src/openclaw/structured-result";
import { SYSTEM_PROMPTS } from "./prompts";
import {
  buildSuggestMessage,
  buildGeneratePlanMessage,
  normalizeGeneratePlanResponse,
  normalizeSuggestResponse,
} from "./features";
import { openclawCall } from "./providers";
import { createLogger, summarizeText } from "../../../lib/logger";

const logger = createLogger("ai.streaming");

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

  logger.info("openclaw.stream.start", {
    feature,
    scope,
    sessionId,
    timeout,
    promptSummary: summarizeText(userMessage, 160),
  });

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

    logger.info("openclaw.stream.response", {
      feature,
      scope,
      sessionId,
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("Content-Type"),
    });

    if (res.ok && res.body) {
      yield { type: "status", message: "AI 正在思考..." };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finalStructured: StreamEvent extends { type: "done"; structured?: infer S } ? S : never;
      const eventCount: Record<string, number> = {};

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
              message?: string;
              phase?: string;
              structured?: StreamEvent extends { type: "done"; structured?: infer S } ? S : never;
            };

            const key = eventType || evt.type || "unknown";
            eventCount[key] = (eventCount[key] ?? 0) + 1;

            if (eventType === "done") {
              fullText = typeof evt.output === "string" ? evt.output : fullText;
              finalStructured = evt.structured;
              logger.info("openclaw.stream.done", {
                feature,
                scope,
                sessionId,
                eventCount,
                textChars: fullText.length,
                structuredStatus: (finalStructured as { status?: unknown } | null | undefined)?.status ?? null,
              });
              yield { type: "done", text: fullText, structured: finalStructured ?? null };
              return;
            }

            if (evt.type === "tool_use" && evt.tool) {
              yield { type: "tool_call", tool: evt.tool, input: evt.input ?? {} };
            } else if (evt.type === "tool_result" && evt.tool) {
              yield { type: "tool_result", tool: evt.tool, result: evt.text ?? evt.result ?? "" };
            } else if (evt.type === "lifecycle") {
              yield { type: "status", message: evt.message ?? evt.phase ?? "Processing" };
            } else if (evt.type === "error") {
              logger.error("openclaw.stream.error_event", {
                feature,
                scope,
                sessionId,
                error: evt.error ?? evt.text ?? evt.message ?? "Unknown error",
              });
              yield { type: "error", message: evt.error ?? evt.text ?? evt.message ?? "Unknown error" };
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
      logger.info("openclaw.stream.done_without_done_event", {
        feature,
        scope,
        sessionId,
        textChars: fullText.length,
      });
      yield { type: "done", text: fullText, structured: finalStructured ?? null };
      return;
    }
  } catch (error) {
    logger.warn("openclaw.stream.fallback_to_blocking", {
      feature,
      scope,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  yield { type: "status", message: "AI 正在生成建议..." };
  try {
    const text = await openclawCall(config, feature, scope, userMessage);
    logger.info("openclaw.stream.blocking_fallback_done", {
      feature,
      scope,
      sessionId,
      textChars: text.length,
    });
    yield { type: "partial", text };
    yield { type: "done", text, structured: null };
  } catch (e) {
    logger.error("openclaw.stream.blocking_fallback_error", {
      feature,
      scope,
      sessionId,
      error: e instanceof Error ? e.message : String(e),
    });
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
function buildSuggestScope(request: SmartSuggestRequest): string {
  const workspace = request.workspaceId ?? "default";
  const normalizedInput = request.input.trim().toLowerCase().slice(0, 120) || "empty";
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${workspace}-${request.kind}-${normalizedInput}-${nonce}`;
}

export async function* suggestStream(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): AsyncGenerator<StreamEvent> {
  const gen = dispatchStream(
    client,
    "suggest",
    buildSuggestMessage(request),
    buildSuggestScope(request),
  );

  let finalText = "";
  let latestToolInput: Record<string, unknown> | null = null;
  let latestStructured: NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]> | null = null;
  for await (const event of gen) {
    if (event.type === "tool_call" && event.tool === "suggest_task_completions") {
      latestToolInput = event.input;
      yield event;
      continue;
    }

    if (event.type === "partial") {
      finalText += event.text;
      yield event;
      continue;
    }

    if (event.type === "done") {
      const text = event.text ?? finalText;
      latestStructured = event.structured;
      const parsed = latestToolInput ?? (() => {
        const structuredParsed = event.structured?.parsed;
        if (structuredParsed && typeof structuredParsed === "object") {
          return structuredParsed;
        }
        try {
          return text ? JSON.parse(text) : { suggestions: [] };
        } catch {
          return { suggestions: [] };
        }
      })();

      const suggestions = normalizeSuggestResponse({
        parsed,
        source: client.type,
        structured: event.structured ?? undefined,
      });
      yield { type: "result", suggestions };
      yield { type: "done", text, structured: latestStructured ?? null };
      return;
    }

    yield event;
  }
}

function extractPreferredPlanGraphFromStructured(
  structured: NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]> | null | undefined,
): Record<string, unknown> | null {
  const toolCalls = (structured as { bridgeToolCalls?: Array<{ tool?: unknown; input?: unknown }> } | null | undefined)?.bridgeToolCalls;
  const toolInput = toolCalls?.find((toolCall) => toolCall.tool === "generate_task_plan_graph")?.input;
  return toolInput && typeof toolInput === "object" ? (toolInput as Record<string, unknown>) : null;
}

function buildGeneratePlanScope(request: GenerateTaskPlanRequest): string {
  const taskPart = request.taskId?.trim() || "adhoc";
  const titlePart = request.title.trim().toLowerCase().slice(0, 120) || "untitled";
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${taskPart}-${titlePart}-${nonce}`;
}

export async function* generatePlanStream(
  client: AiClientRecord,
  request: GenerateTaskPlanRequest,
): AsyncGenerator<StreamEvent> {
  const gen = dispatchStream(
    client,
    "generate_plan",
    buildGeneratePlanMessage(request),
    buildGeneratePlanScope(request),
  );

  let finalText = "";
  let latestToolInput: Record<string, unknown> | null = null;
  let latestStructured: NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]> | null = null;
  for await (const event of gen) {
    if (event.type === "tool_call" && event.tool === "generate_task_plan_graph") {
      latestToolInput = event.input;
      yield event;
      continue;
    }

    if (event.type === "partial") {
      finalText += event.text;
      yield event;
      continue;
    }

    if (event.type === "done") {
      const text = event.text ?? finalText;
      latestStructured = event.structured ?? null;
      const structuredToolGraph = extractPreferredPlanGraphFromStructured(event.structured ?? null);
      let parsed: unknown = latestToolInput ?? structuredToolGraph ?? { summary: "", nodes: [], edges: [] };
      if (!latestToolInput && !structuredToolGraph) {
        try {
          parsed = text ? JSON.parse(text) : parsed;
        } catch {
          parsed = { summary: text || "", nodes: [], edges: [] };
        }
      }
      const plan = normalizeGeneratePlanResponse({
        parsed,
        source: client.type,
        structured: event.structured ?? undefined,
      });
      yield { type: "result", plan };
      yield { type: "done", text, structured: latestStructured ?? null };
      return;
    }

    yield event;
  }
}

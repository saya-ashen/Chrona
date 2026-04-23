/**
 * AI Features — Streaming support (OpenClaw SSE + LLM SSE).
 */

import type {
  AiClientRecord,
  AiFeature,
  OpenClawClientConfig,
  LLMClientConfig,
  SmartSuggestRequest,
  StreamEvent,
  GenerateTaskPlanRequest,
  AnalyzeConflictsRequest,
  SuggestTimeslotRequest,
  ChatRequest,
} from "./types";
import type { StructuredAgentResult } from "@chrona/openclaw-integration/protocol/structured-result";
import type {
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
} from "@chrona/openclaw-integration/transport/bridge-types";
import {
  normalizeGeneratePlanResponse,
  normalizeSuggestResponse,
} from "../features";
import { buildFeatureInput, openclawCall } from "./providers";

function summarizeText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const logger = {
  info: (_message: string, _payload?: Record<string, unknown>) => {},
  warn: (_message: string, _payload?: Record<string, unknown>) => {},
  error: (_message: string, _payload?: Record<string, unknown>) => {},
};

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

function getStreamPath(feature: AiFeature): string | null {
  switch (feature) {
    case "suggest":
      return "/v1/features/suggest/stream";
    case "generate_plan":
      return "/v1/features/generate-plan/stream";
    default:
      return null;
  }
}

function buildStreamingInput(
  feature: AiFeature,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest,
): Record<string, unknown> {
  return buildFeatureInput(feature, input);
}

function parseBridgeEvent(evt: NDJSONEvent): StreamEvent | null {
  if (evt.type === "tool_use" && evt.tool) {
    return {
      type: "tool_call",
      tool: evt.tool,
      input: evt.input ?? {},
    };
  }
  if (evt.type === "tool_result" && evt.tool) {
    return {
      type: "tool_result",
      tool: evt.tool,
      result: evt.result ?? evt.text ?? "",
    };
  }
  if (evt.type === "lifecycle") {
    return {
      type: "status",
      message: evt.message ?? evt.phase ?? "Processing",
    };
  }
  if (evt.type === "error") {
    const message =
      typeof evt.error === "string"
        ? evt.error
        : evt.error?.data?.message ?? evt.text ?? evt.message ?? "Unknown error";
    return { type: "error", message };
  }
  if (evt.type === "text" && evt.text) {
    return { type: "partial", text: evt.text };
  }
  return null;
}

export async function* openclawStream(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest,
): AsyncGenerator<StreamEvent> {
  const timeout = config.timeoutSeconds ?? 120;
  const sessionId = buildOpenClawSessionId(feature, scope);
  const streamPath = getStreamPath(feature);

  logger.info("openclaw.stream.start", {
    feature,
    scope,
    sessionId,
    timeout,
    inputSummary: summarizeText(JSON.stringify(input), 160),
  });

  yield { type: "status", message: "正在连接 AI 服务..." };

  if (streamPath) {
    try {
      const requestBody: BridgeFeatureRequest<Record<string, unknown>> = {
        sessionId,
        input: buildStreamingInput(feature, input),
        timeout,
      };

      const res = await fetch(`${config.bridgeUrl}${streamPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
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
        let finalStructured: StructuredAgentResult | null = null;

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
              if (eventType === "done") {
                const response = JSON.parse(raw) as BridgeResponse;
                fullText = response.output ?? fullText;
                finalStructured = response.structured ?? null;
                yield {
                  type: "done",
                  text: fullText,
                  structured: finalStructured,
                };
                return;
              }

              const event = parseBridgeEvent(JSON.parse(raw) as NDJSONEvent);
              if (!event) continue;
              if (event.type === "partial") {
                fullText += event.text;
              }
              yield event;
              if (event.type === "error") {
                return;
              }
            } catch {
              // ignore malformed SSE chunks
            }
            eventType = "";
          }
        }

        yield {
          type: "done",
          text: fullText,
          structured: finalStructured,
        };
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
  }

  yield { type: "status", message: "AI 正在生成建议..." };
  try {
    const text = await openclawCall(config, feature, scope, input);
    yield { type: "partial", text };
    yield { type: "done", text, structured: null };
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

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
        // skip malformed SSE lines
      }
    }
  }
  yield { type: "done", text: fullText, structured: null };
}

export function dispatchStream(
  client: AiClientRecord,
  feature: AiFeature,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest,
  scope = "default",
): AsyncGenerator<StreamEvent> {
  if (client.type === "openclaw") {
    return openclawStream(
      client.config as OpenClawClientConfig,
      feature,
      scope,
      input,
    );
  }
  return llmStream(
    client.config as LLMClientConfig,
    `Feature: ${feature}`,
    typeof input === "string" ? input : JSON.stringify(input),
    { jsonMode: feature !== "chat" },
  );
}

function buildSuggestScope(request: SmartSuggestRequest): string {
  if (request.sessionKey?.trim()) {
    return request.sessionKey.trim();
  }
  if (request.taskId?.trim()) {
    return `chrona:openclaw:task:${request.taskId.trim()}:default`;
  }
  const workspace = request.workspaceId ?? "default";
  const normalizedInput =
    request.input.trim().toLowerCase().slice(0, 120) || "empty";
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${workspace}-${request.kind}-${normalizedInput}-${nonce}`;
}

export async function* suggestStream(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): AsyncGenerator<StreamEvent> {
  const generator = dispatchStream(
    client,
    "suggest",
    request,
    buildSuggestScope(request),
  );

  let finalText = "";
  let latestToolInput: Record<string, unknown> | null = null;
  let latestStructured: NonNullable<
    Extract<StreamEvent, { type: "done" }>["structured"]
  > | null = null;

  for await (const event of generator) {
    if (
      event.type === "tool_call" &&
      event.tool === "suggest_task_completions"
    ) {
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
      const parsed = latestToolInput ??
        (() => {
          try {
            return text ? JSON.parse(text) : { suggestions: [] };
          } catch {
            return { suggestions: [] };
          }
        })();

      const suggestions = normalizeSuggestResponse({
        parsed,
        source: client.type,
        structured: event.structured,
      });
      yield { type: "result", suggestions };
      yield { type: "done", text, structured: latestStructured ?? null };
      return;
    }

    yield event;
  }
}

function extractPreferredPlanGraphFromStructured(
  structured:
    | NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]>
    | null
    | undefined,
): Record<string, unknown> | null {
  const toolCalls = (
    structured as
      | { bridgeToolCalls?: Array<{ tool?: unknown; input?: unknown }> }
      | null
      | undefined
  )?.bridgeToolCalls;
  const toolInput = toolCalls?.find(
    (toolCall) => toolCall.tool === "generate_task_plan_graph",
  )?.input;
  return toolInput && typeof toolInput === "object"
    ? (toolInput as Record<string, unknown>)
    : null;
}

function buildGeneratePlanScope(request: GenerateTaskPlanRequest): string {
  const taskPart = request.taskId?.trim();
  if (taskPart) {
    return `chrona:openclaw:task:${taskPart}:default`;
  }
  const titlePart =
    request.title.trim().toLowerCase().slice(0, 120) || "untitled";
  const nonce = Math.random().toString(36).slice(2, 10);
  return `adhoc-${titlePart}-${nonce}`;
}

export async function* generatePlanStream(
  client: AiClientRecord,
  request: GenerateTaskPlanRequest,
): AsyncGenerator<StreamEvent> {
  const generator = dispatchStream(
    client,
    "generate_plan",
    request,
    buildGeneratePlanScope(request),
  );

  let finalText = "";
  let latestToolInput: Record<string, unknown> | null = null;
  let latestStructured: NonNullable<
    Extract<StreamEvent, { type: "done" }>["structured"]
  > | null = null;

  for await (const event of generator) {
    if (
      event.type === "tool_call" &&
      event.tool === "generate_task_plan_graph"
    ) {
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
      const structuredToolGraph = extractPreferredPlanGraphFromStructured(
        event.structured ?? null,
      );
      let parsed: unknown = latestToolInput ??
        structuredToolGraph ?? { summary: "", nodes: [], edges: [] };
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
        structured: event.structured,
      });
      yield { type: "result", plan };
      yield { type: "done", text, structured: latestStructured ?? null };
      return;
    }

    yield event;
  }
}

/**
 * AI Features — Streaming support (provider SSE + LLM SSE).
 */

import { createHash } from "node:crypto";

import type {
  AiFeature,
  LLMClientConfig,
  PreparedAiFeatureSpec,
  SmartSuggestRequest,
  StreamEvent,
  GenerateTaskPlanRequest,
  AnalyzeConflictsRequest,
  SuggestTimeslotRequest,
  ChatRequest,
} from "@chrona/contracts";
import { buildSuggestFeatureSpec } from "@chrona/contracts";
import { createDebugDump, previewDebugValue } from "@chrona/shared/debug-dump";
import { createLogger } from "@chrona/shared/logger";
import type {
  ProviderRunEvent,
  ProviderRunInput,
} from "@chrona/providers-foundation";
import { normalizeSuggestResponse } from "./feature-normalizers";
import {
  buildPreparedFeatureRequest,
  buildProviderFeatureRequest,
  providerCall,
} from "./providers";
import type { EngineAiClient } from "./runtime/client-registry";
import { aiClientRegistry } from "./runtime/client-registry";
import { buildSessionIdentity } from "./session";

function summarizeText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const logger = createLogger("ai-features.provider.streaming");

export type PreparedStreamInput = {
  scope: string;
  instructions: string;
  inputText: string;
  input: ProviderRunInput;
  featureSpec?: PreparedAiFeatureSpec;
  userMessage: string;
  signal?: AbortSignal;
};

export function prepareStreamInput(
  scope: string,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest,
  featureSpec?: PreparedAiFeatureSpec,
): PreparedStreamInput {
  const prepared = buildPreparedFeatureRequest(input);
  const signal =
    input && typeof input === "object" && "signal" in input
      ? (input.signal as AbortSignal | undefined)
      : undefined;
  return {
    scope,
    instructions: featureSpec?.instructions ?? prepared.instructions,
    inputText: featureSpec?.inputText ?? prepared.inputText,
    featureSpec,
    input: prepared.input as ProviderRunInput,
    userMessage: featureSpec?.inputText ?? prepared.inputText,
    signal,
  };
}

function toLlmStreamRequest(
  feature: AiFeature,
  input: PreparedStreamInput,
): {
  systemPrompt: string;
  userMessage: string;
  options: { jsonMode: boolean };
} {
  return {
    systemPrompt: input.instructions || `Feature: ${feature}`,
    userMessage: input.userMessage,
    options: { jsonMode: feature !== "chat" },
  };
}

function asToolCallInput(evt: Extract<ProviderRunEvent, { type: "tool_started" }>) {
  if (evt.input !== undefined) return asRecord(evt.input);
  if (evt.preview !== undefined) return { preview: evt.preview };
  return {};
}

function convertProviderEvent(evt: ProviderRunEvent): StreamEvent | null {
  switch (evt.type) {
    case "text_delta":
      return { type: "partial", text: evt.text };
    case "tool_call":
      return {
        type: "tool_call",
        tool: evt.tool,
        input: evt.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool: evt.tool ?? "unknown",
        result:
          typeof evt.result === "string"
            ? evt.result
            : JSON.stringify(evt.result),
      };
    case "tool_started":
      return {
        type: "tool_call",
        tool: evt.toolName,
        input: asToolCallInput(evt),
      };
    case "tool_completed":
      return {
        type: "tool_result",
        tool: evt.toolName ?? "unknown",
        result: evt.error?.message ?? "completed",
        error: Boolean(evt.error),
      };
    case "run_failed":
      return { type: "error", message: evt.error };
    case "run_completed":
      return {
        type: "done",
        text: evt.outputText ?? "",
        structured: isStructuredDebugInfo(evt.structuredPayload)
          ? evt.structuredPayload
          : null,
      };
    case "run_started":
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isStructuredDebugInfo(
  value: unknown,
): value is NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function summarizeStreamEvent(event: StreamEvent | null) {
  if (!event) return null;
  switch (event.type) {
    case "partial":
      return {
        type: event.type,
        textLength: event.text.length,
        text: previewDebugValue(event.text, 300),
      };
    case "tool_call":
      return {
        type: event.type,
        tool: event.tool,
        input: previewDebugValue(event.input, 800),
      };
    case "tool_result":
      return {
        type: event.type,
        tool: event.tool,
        result: previewDebugValue(event.result, 800),
        error: event.error ?? false,
      };
    case "result":
      return { type: event.type, value: previewDebugValue(event, 1200) };
    case "done":
      return {
        type: event.type,
        textLength: event.text?.length ?? 0,
        structured: previewDebugValue(event.structured, 1200),
      };
    default:
      return { ...event };
  }
}

async function* agentProviderStream(
  client: EngineAiClient,
  feature: AiFeature,
  input: PreparedStreamInput,
): AsyncGenerator<StreamEvent> {
  const agentClient = aiClientRegistry.requireProviderClient(client);
  const config = agentClient.record.config;
  const timeout = config.timeoutSeconds ?? 120;
  const { sessionId, sessionKey } = buildSessionIdentity(feature, input.scope);
  const providerInput = buildProviderFeatureRequest({
    sessionKey,
    input: input.input,
    instructions: input.instructions,
    featureSpec: input.featureSpec,
    timeoutSeconds: timeout,
    stream: false,
  });

  logger.info("provider.stream.start", {
    feature,
    scope: input.scope,
    sessionId,
    timeout,
    inputSummary: summarizeText(JSON.stringify(input.input), 160),
  });

  yield { type: "status", message: "正在连接 AI 服务..." };

  const streamableFeatures: AiFeature[] = ["suggest", "generate_plan"];
  if (streamableFeatures.includes(feature)) {
    const dump = await createDebugDump({
      enabledEnv: "CHRONA_AI_STREAM_DUMP",
      directoryEnv: "CHRONA_AI_STREAM_DUMP_DIR",
      kind: "ai-stream",
      label: `${feature}-${input.scope}`,
      meta: {
        layer: "engine.agentProviderStream",
        feature,
        scope: input.scope,
        sessionId,
        sessionKey,
      },
    });
    try {
      await dump?.write({
        type: "yield",
        stage: "provider.status",
        event: { type: "status", message: "AI 正在思考..." },
      });
      yield { type: "status", message: "AI 正在思考..." };
      let fullText = "";

      const session = await agentClient.providerClient.createSession({
        sessionKey,
      });
      const run = await agentClient.providerClient.startRun({
        sessionId: session.sessionId,
        sessionKey,
        instructions: input.instructions,
        input: input.input,
        timeoutMs: timeout * 1000,
        stream: true,
        signal: input.signal,
      });

      for await (const event of agentClient.providerClient.streamRun({
        runId: run.runId,
        signal: input.signal,
      })) {
        const parsed = convertProviderEvent(event);
        await dump?.write({
          type: "provider_event",
          providerEvent: previewDebugValue(event, 1200),
          streamEvent: summarizeStreamEvent(parsed),
        });
        if (!parsed) continue;
        if (parsed.type === "partial") {
          fullText += parsed.text;
        }
        await dump?.write({
          type: "yield",
          stage: "provider.converted",
          event: summarizeStreamEvent(parsed),
        });
        yield parsed;
        if (parsed.type === "error") {
          await dump?.close();
          return;
        }
        if (parsed.type === "done") {
          await dump?.close();
          return;
        }
      }

      logger.info("provider.stream.done", {
        feature,
        scope: input.scope,
        sessionId,
        ok: true,
        textLength: fullText.length,
      });

      await dump?.write({
        type: "yield",
        stage: "provider.done",
        event: { type: "done", textLength: fullText.length, structured: null },
      });
      yield { type: "done", text: fullText, structured: null };
      await dump?.close();
      return;
    } catch (error) {
      await dump?.write({
        type: "error",
        stage: "provider.catch",
        message: error instanceof Error ? error.message : String(error),
      });
      await dump?.close();
      logger.warn("provider.stream.fallback_to_blocking", {
        feature,
        scope: input.scope,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (feature === "generate_plan") {
        yield {
          type: "error",
          message:
            error instanceof Error ? error.message : "Unknown streaming error",
        };
        return;
      }
    }
  }

  yield { type: "status", message: "AI 正在生成建议..." };
  try {
    const text = await providerCall(client, providerInput);
    yield { type: "partial", text };
    yield { type: "done", text, structured: null };
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function* llmStream(
  config: LLMClientConfig,
  systemPrompt: string,
  userMessage: string,
  signal?: AbortSignal,
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

  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: requestSignal,
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
  client: EngineAiClient,
  feature: AiFeature,
  input: PreparedStreamInput,
): AsyncGenerator<StreamEvent> {
  if (client.providerClient) {
    return agentProviderStream(client, feature, input);
  }
  const llmClient = aiClientRegistry.requireLlmClient(client);
  const request = toLlmStreamRequest(feature, input);
  return llmStream(
    llmClient.record.config,
    request.systemPrompt,
    request.userMessage,
    input.signal,
    request.options,
  );
}

function asciiSlug(value: string, maxLength: number): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength)
    .replace(/^-|-$/g, "");
  return normalized || "input";
}

function buildSuggestScope(request: SmartSuggestRequest): string {
  if (request.sessionKey?.trim()) {
    return request.sessionKey.trim();
  }
  if (request.taskId?.trim()) {
    return `chrona:task:${request.taskId.trim()}:default`;
  }
  const workspace = asciiSlug(request.workspaceId ?? "default", 24);
  const normalizedInput = request.input.trim();
  const inputSlug = asciiSlug(normalizedInput, 24);
  const inputHash = createHash("sha1")
    .update(normalizedInput)
    .digest("hex")
    .slice(0, 8);
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${workspace}-${request.kind}-${inputSlug}-${inputHash}-${nonce}`;
}

export async function* suggestStream(
  client: EngineAiClient,
  request: SmartSuggestRequest,
): AsyncGenerator<StreamEvent> {
  const preparedInput = prepareStreamInput(
    buildSuggestScope(request),
    request,
    buildSuggestFeatureSpec(),
  );
  const generator = dispatchStream(client, "suggest", preparedInput);

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
      const parsed =
        latestToolInput ??
        (() => {
          try {
            return text ? JSON.parse(text) : { suggestions: [] };
          } catch {
            return { suggestions: [] };
          }
        })();

      const suggestions = normalizeSuggestResponse({
        parsed,
        source: client.record.type,
        structured: event.structured,
      });
      yield { type: "result", suggestions };
      yield { type: "done", text, structured: latestStructured ?? null };
      return;
    }

    yield event;
  }
}

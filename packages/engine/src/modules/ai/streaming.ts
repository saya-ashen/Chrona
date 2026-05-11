/**
 * AI Features — Streaming support (OpenClaw SSE + LLM SSE).
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
import type { OpenClawStreamEvent as ProviderStreamEvent } from "@chrona/openclaw";
import { normalizeSuggestResponse } from "./feature-normalizers";
import {
  buildPreparedFeatureRequest,
  buildOpenClawFeatureGatewayRequest,
  openclawCall,
} from "./providers";
import type { EngineAiClient } from "./runtime/client-registry";
import { aiClientRegistry } from "./runtime/client-registry";
import { buildOpenClawSessionIdentity } from "./session";

function summarizeText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const logger = createLogger("ai-features.openclaw.streaming");

export type PreparedStreamInput = {
  scope: string;
  instructions: string;
  inputText: string;
  input: Record<string, unknown>;
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
    input: prepared.input,
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

function convertProviderEvent(evt: ProviderStreamEvent): StreamEvent | null {
  switch (evt.type) {
    case "text":
      return { type: "partial", text: evt.data };
    case "done":
      return null;
    case "tool_call":
      return evt.toolCall
        ? {
            type: "tool_call",
            tool: evt.toolCall.tool,
            input: evt.toolCall.input,
          }
        : {
            type: "status",
            message: `Tool call: ${evt.data.slice(0, 80)}`,
          };
    case "tool_result":
      return {
        type: "tool_result",
        tool: evt.toolCall?.tool ?? "unknown",
        result: evt.data,
      };
    case "error":
      return { type: "error", message: evt.data };
    default:
      return null;
  }
}

export function summarizeStreamEvent(event: StreamEvent | null) {
  if (!event) return null;
  switch (event.type) {
    case "partial":
      return { type: event.type, textLength: event.text.length, text: previewDebugValue(event.text, 300) };
    case "tool_call":
      return { type: event.type, tool: event.tool, input: previewDebugValue(event.input, 800) };
    case "tool_result":
      return { type: event.type, tool: event.tool, result: previewDebugValue(event.result, 800) };
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

async function* openclawStream(
  client: EngineAiClient,
  feature: AiFeature,
  input: PreparedStreamInput,
): AsyncGenerator<StreamEvent> {
  const openClawClient = aiClientRegistry.requireOpenClawClient(client);
  const config = openClawClient.record.config;
  const timeout = config.timeoutSeconds ?? 120;
  const { sessionId, sessionKey } = buildOpenClawSessionIdentity(
    feature,
    input.scope,
  );
  const providerInput = buildOpenClawFeatureGatewayRequest({
    feature,
    sessionKey,
    inputText: input.inputText,
    input: input.input,
    instructions: input.instructions,
    featureSpec: input.featureSpec,
    timeoutSeconds: timeout,
    stream: false,
  });

  logger.info("openclaw.stream.start", {
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
        layer: "engine.openclawStream",
        feature,
        scope: input.scope,
        sessionId,
        sessionKey,
      },
    });
    try {
      await dump?.write({ type: "yield", stage: "openclaw.status", event: { type: "status", message: "AI 正在思考..." } });
      yield { type: "status", message: "AI 正在思考..." };
      let fullText = "";

      for await (const event of openClawClient.providerClient.stream({
        request: {
          ...buildOpenClawFeatureGatewayRequest({
            feature,
            sessionKey,
            inputText: input.inputText,
            input: input.input,
            instructions: input.instructions,
            featureSpec: input.featureSpec,
            timeoutSeconds: timeout,
            stream: true,
          }),
          sessionId,
        },
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
        await dump?.write({ type: "yield", stage: "openclaw.converted", event: summarizeStreamEvent(parsed) });
        yield parsed;
        if (parsed.type === "error") {
          await dump?.close();
          return;
        }
      }

      logger.info("openclaw.stream.done", {
        feature,
        scope: input.scope,
        sessionId,
        ok: true,
        textLength: fullText.length,
      });

      await dump?.write({
        type: "yield",
        stage: "openclaw.done",
        event: { type: "done", textLength: fullText.length, structured: null },
      });
      yield { type: "done", text: fullText, structured: null };
      await dump?.close();
      return;
    } catch (error) {
      await dump?.write({
        type: "error",
        stage: "openclaw.catch",
        message: error instanceof Error ? error.message : String(error),
      });
      await dump?.close();
      logger.warn("openclaw.stream.fallback_to_blocking", {
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
    const text = await openclawCall(client, providerInput);
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
  if (client.record.type === "openclaw") {
    return openclawStream(
      client,
      feature,
      input,
    );
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
    return `chrona:openclaw:task:${request.taskId.trim()}:default`;
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

export function extractPreferredPlanGraphFromStructured(
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

function previewText(value: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength
    ? trimmed
    : `${trimmed.slice(0, maxLength - 1)}…`;
}

export function describeGeneratePlanFailure(params: {
  text: string;
  structured:
    | NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]>
    | null
    | undefined;
  latestToolInput: Record<string, unknown> | null;
  structuredToolGraph: Record<string, unknown> | null;
  validationErrors?: Array<{ path: string; message: string }>;
}): string {
  const parts: string[] = [
    "OpenClaw did not return a usable generate_task_plan_graph result.",
  ];

  if (params.latestToolInput) {
    parts.push(
      "A live tool_call was seen, but its payload could not be normalized into a valid plan.",
    );
  } else if (params.structuredToolGraph) {
    parts.push(
      "A structured bridge tool payload existed, but no live tool_call event was emitted.",
    );
  } else {
    parts.push(
      "No generate_task_plan_graph tool payload was found in either streamed tool_call events or the final structured result.",
    );
  }

  const structuredRecord = params.structured as
    | {
        ok?: boolean;
        error?: string | null;
        toolName?: string | null;
        source?: string | null;
        bridgeToolCalls?: Array<{ tool?: string; status?: string }>;
      }
    | null
    | undefined;

  if (
    typeof structuredRecord?.error === "string" &&
    structuredRecord.error.trim()
  ) {
    parts.push(`Structured error: ${structuredRecord.error.trim()}`);
  }
  if (
    typeof structuredRecord?.toolName === "string" &&
    structuredRecord.toolName.trim()
  ) {
    parts.push(`Structured toolName: ${structuredRecord.toolName.trim()}`);
  }
  if (
    typeof structuredRecord?.source === "string" &&
    structuredRecord.source.trim()
  ) {
    parts.push(`Structured source: ${structuredRecord.source.trim()}`);
  }
  if (
    Array.isArray(structuredRecord?.bridgeToolCalls) &&
    structuredRecord!.bridgeToolCalls.length > 0
  ) {
    const toolSummary = structuredRecord!.bridgeToolCalls
      .map(
        (toolCall) =>
          `${toolCall.tool ?? "unknown"}${toolCall.status ? `(${toolCall.status})` : ""}`,
      )
      .join(", ");
    parts.push(`Bridge tool calls seen: ${toolSummary}`);
  }

  const textPreview = previewText(params.text, 240);
  if (textPreview) {
    parts.push(`Raw output preview: ${textPreview}`);
  }

  if (params.validationErrors && params.validationErrors.length > 0) {
    parts.push(
      `Validation errors: ${params.validationErrors
        .slice(0, 3)
        .map((error) => `${error.path || "<root>"}: ${error.message}`)
        .join(" | ")}`,
    );
  }

  return parts.join(" ");
}

export function buildGeneratePlanDiagnostics(params: {
  text: string;
  structured:
    | NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]>
    | null
    | undefined;
  latestToolInput: Record<string, unknown> | null;
  structuredToolGraph: Record<string, unknown> | null;
  validationErrors?: Array<{ path: string; message: string }>;
  validationWarnings?: Array<{ path: string; message: string }>;
}): Record<string, unknown> {
  const structuredRecord = params.structured as
    | {
        ok?: boolean;
        error?: string | null;
        feature?: string | null;
        toolName?: string | null;
        source?: string | null;
        sessionId?: string | null;
        runId?: string | null;
        bridgeToolCalls?: Array<{
          tool?: string;
          callId?: string;
          status?: string;
          input?: unknown;
        }>;
      }
    | null
    | undefined;

  return {
    hasLiveToolCall: Boolean(params.latestToolInput),
    hasStructuredToolGraph: Boolean(params.structuredToolGraph),
    rawTextPreview: previewText(params.text, 400),
    validationErrors: params.validationErrors ?? [],
    validationWarnings: params.validationWarnings ?? [],
    structured: structuredRecord
      ? {
          ok: structuredRecord.ok ?? null,
          error: structuredRecord.error ?? null,
          feature: structuredRecord.feature ?? null,
          toolName: structuredRecord.toolName ?? null,
          source: structuredRecord.source ?? null,
          sessionId: structuredRecord.sessionId ?? null,
          runId: structuredRecord.runId ?? null,
          bridgeToolCalls: Array.isArray(structuredRecord.bridgeToolCalls)
            ? structuredRecord.bridgeToolCalls.map((toolCall) => ({
                tool: toolCall.tool ?? null,
                callId: toolCall.callId ?? null,
                status: toolCall.status ?? null,
                inputPreview:
                  toolCall.input && typeof toolCall.input === "object"
                    ? previewText(JSON.stringify(toolCall.input), 240)
                    : null,
              }))
            : [],
        }
      : null,
  };
}

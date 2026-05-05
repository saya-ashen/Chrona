/**
 * AI Features — Streaming support (OpenClaw SSE + LLM SSE).
 */

import { createHash } from "node:crypto";

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
} from "@chrona/contracts";
import { createLogger } from "@chrona/db/logger";
import type { StreamEvent as ProviderStreamEvent } from "@chrona/providers-core";
import {
  normalizeGeneratePlanResponse,
  normalizeSuggestResponse,
} from "./feature-normalizers";
import {
  buildPreparedFeatureRequest,
  openclawCall,
  getOrCreateClient,
} from "./providers";
import { buildOpenClawSessionIdentity } from "./session";

function summarizeText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

const logger = createLogger("ai-features.openclaw.streaming");

function toFeatureInput(
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest,
): Record<string, unknown> {
  const prepared = buildPreparedFeatureRequest(input);
  return {
    instructions: prepared.instructions,
    inputText: prepared.inputText,
    featureSpec: prepared.featureSpec,
    input: prepared.input,
  };
}

function convertProviderEvent(evt: ProviderStreamEvent): StreamEvent | null {
  switch (evt.type) {
    case "text":
      return { type: "partial", text: evt.data };
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

async function* openclawStream(
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
  const { sessionId, sessionKey } = buildOpenClawSessionIdentity(
    feature,
    scope,
  );

  logger.info("openclaw.stream.start", {
    feature,
    scope,
    sessionId,
    timeout,
    inputSummary: summarizeText(JSON.stringify(input), 160),
  });

  yield { type: "status", message: "正在连接 AI 服务..." };

  const streamableFeatures: AiFeature[] = ["suggest", "generate_plan"];
  if (streamableFeatures.includes(feature)) {
    try {
      const client = getOrCreateClient(config);

      yield { type: "status", message: "AI 正在思考..." };
      let fullText = "";

      for await (const event of client.executeFeatureStream(
        feature as "suggest" | "generate_plan",
        {
          sessionKey,
          ...toFeatureInput(input),
          timeout,
        },
      )) {
        const parsed = convertProviderEvent(event);
        if (!parsed) continue;
        if (parsed.type === "partial") {
          fullText += parsed.text;
        }
        yield parsed;
        if (parsed.type === "error") {
          return;
        }
      }

      logger.info("openclaw.stream.done", {
        feature,
        scope,
        sessionId,
        ok: true,
        textLength: fullText.length,
      });

      yield { type: "done", text: fullText, structured: null };
      return;
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
      const text = await openclawCall(config, feature, {
        ...buildPreparedFeatureRequest(input),
        sessionKey: scope,
      });
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

function dispatchStream(
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

function previewText(value: string, maxLength: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength
    ? trimmed
    : `${trimmed.slice(0, maxLength - 1)}…`;
}

function describeGeneratePlanFailure(params: {
  text: string;
  structured:
    | NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]>
    | null
    | undefined;
  latestToolInput: Record<string, unknown> | null;
  structuredToolGraph: Record<string, unknown> | null;
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

  return parts.join(" ");
}

function buildGeneratePlanDiagnostics(params: {
  text: string;
  structured:
    | NonNullable<Extract<StreamEvent, { type: "done" }>["structured"]>
    | null
    | undefined;
  latestToolInput: Record<string, unknown> | null;
  structuredToolGraph: Record<string, unknown> | null;
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

export function buildGeneratePlanScope(
  request: GenerateTaskPlanRequest,
): string {
  if (request.sessionKey?.trim()) {
    return request.sessionKey.trim();
  }
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
      let parsed: unknown = latestToolInput ?? structuredToolGraph ?? null;
      if (!latestToolInput && !structuredToolGraph) {
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
      }
      if (!parsed || typeof parsed !== "object") {
        const diagnostics = buildGeneratePlanDiagnostics({
          text,
          structured: event.structured ?? null,
          latestToolInput,
          structuredToolGraph,
        });
        yield {
          type: "error",
          message: describeGeneratePlanFailure({
            text,
            structured: event.structured ?? null,
            latestToolInput,
            structuredToolGraph,
          }),
          rawText: text,
          structured: event.structured ?? null,
          diagnostics,
        };
        return;
      }
      const plan = normalizeGeneratePlanResponse({
        parsed,
        source: client.type,
        structured: event.structured,
      });
      if (plan.blueprint.nodes.length === 0) {
        const diagnostics = buildGeneratePlanDiagnostics({
          text,
          structured: event.structured ?? null,
          latestToolInput,
          structuredToolGraph,
        });
        yield {
          type: "error",
          message: `${describeGeneratePlanFailure({
            text,
            structured: event.structured ?? null,
            latestToolInput,
            structuredToolGraph,
          })} Normalized plan blueprint contained zero nodes.`,
          rawText: text,
          structured: event.structured ?? null,
          diagnostics,
        };
        return;
      }
      yield { type: "result", plan };
      yield { type: "done", text, structured: latestStructured ?? null };
      return;
    }

    yield event;
  }
}

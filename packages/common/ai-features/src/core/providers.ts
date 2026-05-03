import type {
  AiClientRecord,
  AiFeature,
  OpenClawClientConfig,
  LLMClientConfig,
  SmartSuggestRequest,
  GenerateTaskPlanRequest,
  AnalyzeConflictsRequest,
  SuggestTimeslotRequest,
  ChatRequest,
  DispatchTaskInput,
} from "./types";
import { AiClientError } from "./types";
import { createLogger } from "@chrona/db/logger";
import {
  coerceStructuredResult,
  parseTextJsonWithFallback,
  type OpenClawCallResult,
  type OpenClawStructuredMode,
} from "./structured";
import type {
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
} from "@chrona/openclaw-integration/bridge/contracts";
import { SYSTEM_PROMPTS } from "./prompts";
import { buildOpenClawSessionIdentity } from "./session";

const logger = createLogger("ai-features.openclaw.providers");

function toBridgeFeature(feature: AiFeature): BridgeFeature {
  switch (feature) {
    case "generate_plan":
      return "generate_plan";
    case "suggest":
      return "suggest";
    case "conflicts":
      return "conflicts";
    case "timeslots":
      return "timeslots";
    case "chat":
      return "chat";
    case "dispatch_task":
      return "dispatch_task";
  }
}

export function extractJSON<T>(raw: string, clientType: string): T {
  return parseTextJsonWithFallback<T>(raw, clientType);
}

function buildGeneratePlanInput(input: GenerateTaskPlanRequest): Record<string, unknown> {
  const task: Record<string, unknown> = {
    title: input.title,
  };

  if (input.description?.trim()) {
    task.description = input.description;
  }
  if (typeof input.estimatedMinutes === "number") {
    task.estimatedDurationMinutes = input.estimatedMinutes;
  }

  return { task };
}

export function buildFeatureInput(
  feature: AiFeature,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest
    | DispatchTaskInput,
): Record<string, unknown> {
  if (typeof input === "string") {
    return { message: input };
  }
  if (feature === "generate_plan") {
    return buildGeneratePlanInput(input as GenerateTaskPlanRequest);
  }
  return input as unknown as Record<string, unknown>;
}

function getBridgePath(feature: BridgeFeature, stream: boolean): string {
  switch (feature) {
    case "suggest":
      return stream ? "/v1/features/suggest/stream" : "/v1/features/suggest";
    case "generate_plan":
      return stream
        ? "/v1/features/generate-plan/stream"
        : "/v1/features/generate-plan";
    case "conflicts":
      return "/v1/features/analyze-conflicts";
    case "timeslots":
      return "/v1/features/suggest-timeslot";
    case "chat":
      return "/v1/features/chat";
    case "dispatch_task":
      return "/v1/features/dispatch-task";
  }
}

function getBridgeHeaders(config: OpenClawClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.bridgeToken.trim()) {
    headers.Authorization = `Bearer ${config.bridgeToken}`;
  }

  return headers;
}

function getBridgeBaseUrl(config: OpenClawClientConfig): string {
  return config.bridgeUrl.replace(/\/+$/, "");
}

async function postBridgeFeature(
  config: OpenClawClientConfig,
  feature: BridgeFeature,
  body: BridgeFeatureRequest<Record<string, unknown>>,
): Promise<BridgeResponse> {
  const res = await fetch(`${getBridgeBaseUrl(config)}${getBridgePath(feature, false)}`, {
    method: "POST",
    headers: getBridgeHeaders(config),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(((body.timeout ?? 120) + 15) * 1000),
  });

  const text = await res.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new AiClientError(
      `Bridge call failed (${res.status}): ${text.slice(0, 200)}`,
      "openclaw",
      "internal",
    );
  }

  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error ?? text)
        : text;
    throw new AiClientError(
      `Bridge call failed (${res.status}): ${message}`,
      "openclaw",
      "internal",
    );
  }

  return parsed as BridgeResponse;
}

export async function postBridgeFeatureStream(
  config: OpenClawClientConfig,
  feature: BridgeFeature,
  body: BridgeFeatureRequest<Record<string, unknown>>,
): Promise<{ response: BridgeResponse; events: NDJSONEvent[] }> {
  const res = await fetch(`${getBridgeBaseUrl(config)}${getBridgePath(feature, true)}`, {
    method: "POST",
    headers: getBridgeHeaders(config),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(((body.timeout ?? 120) + 15) * 1000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new AiClientError(
      `Bridge stream call failed (${res.status}): ${errBody.slice(0, 400)}`,
      "openclaw",
      "internal",
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new AiClientError("No response body for streaming", "openclaw", "internal");
  }

  const decoder = new TextDecoder();
  const events: NDJSONEvent[] = [];
  let buffer = "";
  let finalResponse: BridgeResponse | null = null;

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
        const data = JSON.parse(raw) as NDJSONEvent | BridgeResponse;
        if (eventType === "done") {
          finalResponse = data as BridgeResponse;
        } else if (eventType === "event") {
          events.push(data as NDJSONEvent);
        }
      } catch {
        // ignore malformed SSE lines
      }
      eventType = "";
    }
  }

  if (!finalResponse) {
    throw new AiClientError(
      "Stream ended without a final response",
      "openclaw",
      "internal",
    );
  }

  return { response: finalResponse, events };
}

async function fetchOpenClawBridge(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest
    | DispatchTaskInput,
  mode: OpenClawStructuredMode,
): Promise<OpenClawCallResult> {
  const timeout = config.timeoutSeconds ?? 120;
  const { sessionId, sessionKey } = buildOpenClawSessionIdentity(feature, scope);
  const requestBody: BridgeFeatureRequest<Record<string, unknown>> = {
    sessionId,
    sessionKey,
    input: buildFeatureInput(feature, input),
    instructions: SYSTEM_PROMPTS[feature],
    timeout,
  };

  const bridge = await postBridgeFeature(
    config,
    toBridgeFeature(feature),
    requestBody,
  );

  if (bridge.error) {
    throw new AiClientError(bridge.error, "openclaw", "internal");
  }

  return coerceStructuredResult(bridge, mode);
}

export async function openclawCall(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest
    | DispatchTaskInput,
): Promise<string> {
  const result = await fetchOpenClawBridge(config, feature, scope, input, "text");
  return result.text;
}

async function openclawStructuredCall<T = unknown>(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest
    | DispatchTaskInput,
): Promise<OpenClawCallResult<T>> {
  const result = await fetchOpenClawBridge(
    config,
    feature,
    scope,
    input,
    "structured",
  );
  return {
    ...result,
    structured: result.structured
      ? {
          ...result.structured,
          parsed: (result.structured.parsed ?? null) as T | null,
        }
      : null,
  };
}

async function openclawHealthCheck(
  config: OpenClawClientConfig,
): Promise<boolean> {
  try {
    if (!config.bridgeUrl.trim()) {
      return false;
    }
    const res = await fetch(`${getBridgeBaseUrl(config)}/v1/health`, {
      headers: getBridgeHeaders(config),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      return false;
    }

    const body = (await res.json().catch(() => null)) as { status?: string } | null;
    return body?.status === "ok";
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
    throw new AiClientError(
      "No response body for streaming",
      "llm",
      "internal",
    );
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

function llmHealthCheck(config: LLMClientConfig): boolean {
  return Boolean(config.baseUrl && config.apiKey);
}

export async function dispatch(
  client: AiClientRecord,
  feature: AiFeature,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest
    | DispatchTaskInput,
  scope = "default",
): Promise<string> {
  if (client.type === "openclaw") {
    return openclawCall(
      client.config as OpenClawClientConfig,
      feature,
      scope,
      input,
    );
  }
  const userMessage = typeof input === "string" ? input : JSON.stringify(input);
  return llmCall(
    client.config as LLMClientConfig,
    `Feature: ${toBridgeFeature(feature)}`,
    userMessage,
    { jsonMode: feature !== "chat" },
  );
}

export async function dispatchStructured<T = unknown>(
  client: AiClientRecord,
  feature: AiFeature,
  input:
    | string
    | SmartSuggestRequest
    | GenerateTaskPlanRequest
    | AnalyzeConflictsRequest
    | SuggestTimeslotRequest
    | ChatRequest
    | DispatchTaskInput,
  scope = "default",
): Promise<OpenClawCallResult<T>> {
  if (client.type === "openclaw") {
    return openclawStructuredCall<T>(
      client.config as OpenClawClientConfig,
      feature,
      scope,
      input,
    );
  }

  const userMessage = typeof input === "string" ? input : JSON.stringify(input);
  const text = await llmCall(
    client.config as LLMClientConfig,
    `Feature: ${toBridgeFeature(feature)}`,
    userMessage,
    { jsonMode: feature !== "chat" },
  );

  return {
    mode: "structured",
    text,
    structured: null,
    bridge: {
      sessionId: buildOpenClawSessionIdentity(feature, scope).sessionId,
      runId: undefined,
      output: text,
      toolCalls: [],
      usage: null,
      error: null,
      durationMs: 0,
      structured: null,
      feature: null,
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


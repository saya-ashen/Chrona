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
} from "@chrona/openclaw-integration/bridge/contracts";

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

function getBridgePath(feature: AiFeature, stream = false): string {
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

export function extractJSON<T>(raw: string, clientType: string): T {
  return parseTextJsonWithFallback<T>(raw, clientType);
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
  return input as unknown as Record<string, unknown>;
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
  const sessionId = buildOpenClawSessionId(feature, scope);
  const requestBody: BridgeFeatureRequest<Record<string, unknown>> = {
    sessionId,
    input: buildFeatureInput(feature, input),
    timeout,
  };

  const res = await fetch(`${config.bridgeUrl}${getBridgePath(feature)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout((timeout + 15) * 1000),
  });

  const rawText = await res.text().catch(() => "");
  let bridge: BridgeResponse;
  try {
    bridge = JSON.parse(rawText) as BridgeResponse;
  } catch {
    throw new AiClientError(
      `Bridge returned non-JSON response (${res.status}): ${rawText.slice(0, 200)}`,
      "openclaw",
      "internal",
    );
  }

  if (!res.ok) {
    throw new AiClientError(
      bridge.error ?? `Bridge returned ${res.status}`,
      "openclaw",
      "internal",
    );
  }

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

export async function openclawStructuredCall<T = unknown>(
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

export function llmHealthCheck(config: LLMClientConfig): boolean {
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
      sessionId: buildOpenClawSessionId(feature, scope),
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

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
  StructuredDebugInfo,
} from "./types";
import { AiClientError } from "./types";
import { createLogger } from "@chrona/db/logger";
import { parseTextJsonWithFallback } from "./structured";
import type {
  BridgeFeature,
  BridgeFeatureRequest,
  BridgeResponse,
  NDJSONEvent,
} from "@chrona/openclaw-integration";
import { SYSTEM_PROMPTS } from "./prompts";
import { buildOpenClawSessionIdentity } from "./session";
import { OpenClawClient } from "@chrona/providers-core";

const _logger = createLogger("ai-features.openclaw.providers");

const clientCache = new Map<string, OpenClawClient>();

function getOrCreateClient(config: OpenClawClientConfig): OpenClawClient {
  const gatewayUrl = config.gatewayUrl || config.bridgeUrl;
  const key = `${gatewayUrl}|${config.gatewayToken ?? config.bridgeToken ?? ""}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new OpenClawClient({
      gatewayUrl,
      gatewayToken: config.gatewayToken || config.bridgeToken,
      timeoutSeconds: config.timeoutSeconds,
    });
    clientCache.set(key, client);
  }
  return client;
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

export function extractJSON<T>(raw: string, clientType: string): T {
  return parseTextJsonWithFallback<T>(raw, clientType);
}

export type FeaturePayloadResult<T> = {
  parsed: T;
  rawText: string;
  debug?: StructuredDebugInfo;
};

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

async function postBridgeFeature(
  config: OpenClawClientConfig,
  feature: BridgeFeature,
  body: BridgeFeatureRequest<Record<string, unknown>>,
): Promise<BridgeResponse> {
  try {
    const client = getOrCreateClient(config);
    return await client.executeFeature(feature, {
      sessionKey: body.sessionKey,
      instructions: body.instructions,
      timeout: body.timeout,
      ...(body.input as Record<string, unknown> ?? {}),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Bridge call failed";
    throw new AiClientError(message, "openclaw", "internal");
  }
}

export async function postBridgeFeatureStream(
  config: OpenClawClientConfig,
  feature: BridgeFeature,
  body: BridgeFeatureRequest<Record<string, unknown>>,
): Promise<{ response: BridgeResponse; events: NDJSONEvent[] }> {
  const client = getOrCreateClient(config);
  const events: NDJSONEvent[] = [];
  let output = "";

  for await (const event of client.executeFeatureStream(feature, {
    sessionKey: body.sessionKey,
    instructions: body.instructions,
    timeout: body.timeout,
    ...(body.input as Record<string, unknown> ?? {}),
  })) {
    events.push({ type: event.type, data: event.data } as unknown as NDJSONEvent);
    if (event.type === "text") output += event.data;
  }

  return {
    response: {
      sessionId: body.sessionKey ?? "",
      output,
      toolCalls: [],
      usage: null,
      error: null,
      durationMs: 0,
      structured: null,
      feature: null,
    },
    events,
  };
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
): Promise<BridgeResponse> {
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

  return bridge;
}

function toStructuredDebugInfo(bridge: BridgeResponse): StructuredDebugInfo | undefined {
  const feature = bridge.feature;
  const structured = bridge.structured;
  if (!feature && !structured) {
    return undefined;
  }

  return {
    rawOutput: structured?.rawOutput ?? bridge.output,
    error: structured?.error ?? bridge.error,
    source: structured?.source ?? feature?.source,
    feature: structured?.feature ?? feature?.feature ?? null,
    toolName: structured?.toolName ?? feature?.toolName ?? null,
    sessionId: structured?.sessionId ?? bridge.sessionId,
    runId: structured?.runId ?? bridge.runId,
    validationIssues: structured?.validationIssues,
    bridgeToolCalls: structured?.bridgeToolCalls ?? bridge.toolCalls.map((toolCall) => ({
      tool: toolCall.tool,
      callId: toolCall.callId,
      input: toolCall.input,
      result: toolCall.result,
      status: toolCall.status,
    })),
  };
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
  const bridge = await fetchOpenClawBridge(config, feature, scope, input);
  return bridge.output;
}

async function openclawFeaturePayload<T>(
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
): Promise<FeaturePayloadResult<T>> {
  const bridge = await fetchOpenClawBridge(config, feature, scope, input);
  const payload = bridge.feature?.payload;

  if (payload == null) {
    throw new AiClientError(
      bridge.structured?.error ?? `Feature '${feature}' did not return a parsed payload`,
      "openclaw",
      "invalid_response",
    );
  }

  return {
    parsed: payload as T,
    rawText: bridge.output,
    debug: toStructuredDebugInfo(bridge),
  };
}

async function openclawHealthCheck(
  config: OpenClawClientConfig,
): Promise<boolean> {
  try {
    const gatewayUrl = config.gatewayUrl ?? config.bridgeUrl;
    if (!gatewayUrl?.trim()) {
      return false;
    }
    const client = getOrCreateClient(config);
    return await client.checkHealth();
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

export async function dispatchFeaturePayload<T = unknown>(
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
): Promise<FeaturePayloadResult<T>> {
  if (client.type === "openclaw") {
    return openclawFeaturePayload<T>(
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
    parsed: extractJSON<T>(text, client.type),
    rawText: text,
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

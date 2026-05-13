import { checkGatewayAvailable, normalizeGatewayHttpUrl } from "@chrona/openclaw";
import type {
  ProviderRunSnapshot,
  StartRunInput,
} from "@chrona/providers-foundation";
import type {
  AiClientRecord,
  AiFeature,
  OpenClawClientConfig,
  LLMClientConfig,
  PreparedAiFeatureSpec,
  StructuredDebugInfo,
} from "@chrona/contracts";
import {
  AiClientError,
  OPENCLAW_DEFAULT_MODEL,
  validatePreparedFeaturePayload,
} from "@chrona/contracts";
import type { OpenClawGatewayRequest } from "@chrona/openclaw";
import type { EngineAiClient } from "./runtime/client-registry";
import { aiClientRegistry } from "./runtime/client-registry";

function getOpenClawGatewayUrl(config: OpenClawClientConfig): string | undefined {
  return typeof config.gatewayUrl === "string" && config.gatewayUrl
    ? config.gatewayUrl
    : config.bridgeUrl;
}

async function checkClientHealth(
  client: AiClientRecord,
): Promise<{ available: boolean; reason: string }> {
  try {
    if (client.type === "openclaw") {
      const config = client.config as OpenClawClientConfig;
      const gatewayUrl = getOpenClawGatewayUrl(config);
      if (!gatewayUrl) {
        return { available: false, reason: "Gateway URL is required" };
      }

      const healthy = await checkGatewayAvailable({
        gatewayHttpUrl: normalizeGatewayHttpUrl(gatewayUrl),
        gatewayToken: config.gatewayToken ?? config.bridgeToken ?? "",
        agentId: "main",
        model: config.model?.trim() || OPENCLAW_DEFAULT_MODEL,
      });
      return healthy
        ? { available: true, reason: "Gateway is reachable" }
        : { available: false, reason: "Gateway health check failed" };
    }

    if (client.type === "llm") {
      const config = client.config as LLMClientConfig;
      if (typeof config.baseUrl !== "string" || !config.baseUrl) {
        return { available: false, reason: "Base URL is required" };
      }
      if (typeof config.apiKey !== "string" || !config.apiKey) {
        return { available: false, reason: "API key is required" };
      }
      try {
        const res = await fetch(`${config.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return { available: true, reason: "LLM API is reachable" };
        return { available: false, reason: `LLM returned ${res.status}` };
      } catch (error) {
        return {
          available: false,
          reason:
            error instanceof Error ? error.message : "Failed to reach LLM",
        };
      }
    }

    return { available: false, reason: `Unknown client type: ${client.type}` };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error ? error.message : "Client health check failed",
    };
  }
}

export async function testAiClientAvailability(input: {
  type: AiClientRecord["type"];
  config?: Record<string, unknown>;
}): Promise<{ available: boolean; reason: string }> {
  return checkClientHealth({
    id: "test-client",
    name: "Test Client",
    type: input.type,
    config: (input.config ?? {}) as unknown as AiClientRecord["config"],
    isDefault: false,
    enabled: true,
  });
}

export function extractJSON(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to regex extraction */
  }

  const jsonMatch =
    trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ??
    trimmed.match(/(\{[\s\S]*\})/);
  if (!jsonMatch?.[1]) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1].trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function openclawFeaturePayload(
  client: EngineAiClient,
  request: OpenClawGatewayRequest,
): Promise<string> {
  const openClawClient = aiClientRegistry.requireOpenClawClient(client).providerClient;
  const result = await runOpenClawRequest(openClawClient, request);
  if (result.error) {
    throw new AiClientError(result.error, client.record.type, "internal");
  }
  return result.outputText ?? "";
}

function toStartRunInput(request: OpenClawGatewayRequest): StartRunInput {
  return {
    sessionId: request.sessionId,
    sessionKey: request.sessionKey,
    instructions: request.instructions,
    input: request.input,
    structuredOutputSchema: request.structuredOutputSchema,
    maxOutputTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutSeconds
      ? request.timeoutSeconds * 1000
      : undefined,
    stream: true,
  };
}

async function runOpenClawRequest(
  providerClient: NonNullable<EngineAiClient["providerClient"]>,
  request: OpenClawGatewayRequest,
): Promise<ProviderRunSnapshot> {
  let finalSnapshot: ProviderRunSnapshot | null = null;
  for await (const event of providerClient.streamRun({
    ...toStartRunInput(request),
    stream: true,
  })) {
    if (event.type === "run_completed") {
      finalSnapshot = {
        provider: providerClient.provider,
        runId: event.run.runId,
        nativeRunId: event.run.nativeRunId,
        sessionId: event.run.sessionId,
        status: event.run.status ?? "completed",
        outputText: event.outputText,
        structuredPayload: event.structuredPayload,
        usage: event.usage,
        error: null,
        raw: event.raw,
      };
    }
    if (event.type === "run_failed") {
      finalSnapshot = {
        provider: providerClient.provider,
        runId: event.run?.runId ?? crypto.randomUUID(),
        nativeRunId: event.run?.nativeRunId,
        sessionId: event.run?.sessionId ?? request.sessionId,
        status: "failed",
        error: event.error,
        raw: event.raw,
      };
    }
  }
  if (!finalSnapshot) {
    throw new AiClientError(
      "OpenClaw run finished without a provider snapshot",
      "openclaw",
      "invalid_response",
    );
  }
  return finalSnapshot;
}

async function llmFeaturePayload(
  client: AiClientRecord,
  systemPrompt: string,
  userMessage: string,
  options?: { jsonMode?: boolean; temperature?: number },
): Promise<string> {
  const config = client.config as LLMClientConfig;
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: options?.temperature ?? config.temperature ?? 0.7,
    max_tokens: 4096,
  };
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
    throw new AiClientError(
      `LLM returned ${res.status}: ${errText.slice(0, 300)}`,
      client.type,
      "internal",
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new AiClientError(json.error.message, client.type, "internal");
  }

  return json.choices?.[0]?.message?.content ?? "";
}

export async function openclawCall(
  client: EngineAiClient,
  request: OpenClawGatewayRequest,
): Promise<string> {
  return openclawFeaturePayload(client, request);
}

export async function llmCall(
  config: LLMClientConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { jsonMode?: boolean; temperature?: number },
): Promise<string> {
  return llmFeaturePayload(
    { type: "llm", config, enabled: true } as AiClientRecord,
    systemPrompt,
    userMessage,
    options,
  );
}

export function buildPreparedFeatureRequest(input: unknown): {
  input: Record<string, unknown>;
  instructions: string;
  inputText: string;
} {
  const inputObj =
    typeof input === "string" ? { input } : (input as Record<string, unknown>);
  const inputText =
    typeof input === "string"
      ? input
      : typeof inputObj.title === "string"
        ? inputObj.title
        : JSON.stringify(inputObj);

  return {
    input: inputObj,
    instructions: inputText,
    inputText,
  };
}

export function buildOpenClawFeatureGatewayRequest(input: {
  sessionKey: string;
  input: unknown;
  instructions?: string;
  featureSpec?: PreparedAiFeatureSpec;
  timeoutSeconds?: number;
  stream: boolean;
  maxOutputTokens?: number;
}): OpenClawGatewayRequest {
  const fallbackInstructions =
    input.instructions ??
    (typeof input.input === "string" ? input.input : JSON.stringify(input.input));

  return {
    sessionId: input.sessionKey,
    sessionKey: input.sessionKey,
    instructions: input.featureSpec?.instructions ?? fallbackInstructions,
    input: input.input,
    structuredOutputSchema: input.featureSpec?.structuredOutputSchema,
    stream: input.stream,
    maxOutputTokens: input.maxOutputTokens,
    timeoutSeconds: input.timeoutSeconds,
  };
}

// ────────────────────────────────────────────────────────────────────
// Dispatch helpers (used by feature-normalizers)
// ────────────────────────────────────────────────────────────────────

type FeaturePayloadResult<T> = {
  parsed: T;
  rawText: string;
  debug?: StructuredDebugInfo;
};

async function openclawFeaturePayloadFull<T>(
  client: EngineAiClient,
  feature: AiFeature,
  request: OpenClawGatewayRequest,
  featureSpec?: PreparedAiFeatureSpec,
): Promise<FeaturePayloadResult<T>> {
  const openClawClient = aiClientRegistry.requireOpenClawClient(client).providerClient;
  const result = await runOpenClawRequest(openClawClient, request);

  if (result.error) {
    throw new AiClientError(result.error, client.record.type, "internal");
  }

  const rawPayload =
    result.structuredPayload &&
    typeof result.structuredPayload === "object" &&
    "parsed" in result.structuredPayload
      ? result.structuredPayload.parsed
      : null;

  if (rawPayload == null) {
    throw new AiClientError(
      `Feature '${feature}' did not return a parsed payload`,
      client.record.type,
      "invalid_response",
    );
  }

  if (featureSpec) {
    const validation = validatePreparedFeaturePayload(featureSpec, rawPayload);
    if (!validation.ok) {
      throw new AiClientError(
        validation.error,
        client.record.type,
        "invalid_response",
      );
    }
  }

  return {
    parsed: rawPayload as T,
    rawText: result.outputText ?? "",
    debug: {
      rawOutput: getStructuredString(result.structuredPayload, "rawOutput") ?? result.outputText,
      error: getStructuredString(result.structuredPayload, "error") ?? result.error,
      source: getStructuredString(result.structuredPayload, "source") as StructuredDebugInfo["source"],
      feature: getStructuredString(result.structuredPayload, "feature") ?? featureSpec?.feature ?? null,
      toolName:
        getStructuredString(result.structuredPayload, "toolName") ??
        featureSpec?.structuredOutputSchema.name ??
        null,
      sessionId: getStructuredString(result.structuredPayload, "sessionId") ?? result.sessionId,
      runId: getStructuredString(result.structuredPayload, "runId") ?? result.runId,
      validationIssues: getStructuredValidationIssues(result.structuredPayload),
    },
  };
}

function getStructuredField(payload: unknown, field: string): unknown {
  return payload && typeof payload === "object" && field in payload
    ? (payload as Record<string, unknown>)[field]
    : undefined;
}

function getStructuredString(payload: unknown, field: string): string | undefined {
  const value = getStructuredField(payload, field);
  return typeof value === "string" ? value : undefined;
}

function getStructuredValidationIssues(
  payload: unknown,
): StructuredDebugInfo["validationIssues"] {
  const value = getStructuredField(payload, "validationIssues");
  return Array.isArray(value)
    ? (value as StructuredDebugInfo["validationIssues"])
    : undefined;
}

export async function dispatch(
  client: EngineAiClient,
  feature: AiFeature,
  input: unknown,
  scope = "default",
): Promise<string> {
  if (client.record.type === "openclaw") {
    return openclawFeaturePayload(client, {
      ...buildOpenClawFeatureGatewayRequest({
        sessionKey: scope,
        instructions: `Feature: ${feature}`,
        input,
        stream: false,
      }),
    });
  }
  const llmClient = aiClientRegistry.requireLlmClient(client);
  const userMessage = typeof input === "string" ? input : JSON.stringify(input);
  return llmCall(
    llmClient.record.config,
    `Feature: ${feature}`,
    userMessage,
    { jsonMode: feature !== "chat" },
  );
}

export async function dispatchFeaturePayload<T = unknown>(
  client: EngineAiClient,
  feature: AiFeature,
  input: unknown,
  scope = "default",
): Promise<FeaturePayloadResult<T>> {
  if (client.record.type === "openclaw") {
    return openclawFeaturePayloadFull<T>(client, feature, {
      ...buildOpenClawFeatureGatewayRequest({
        sessionKey: scope,
        instructions: `Feature: ${feature}`,
        input,
        stream: false,
      }),
    });
  }

  const llmClient = aiClientRegistry.requireLlmClient(client);
  const userMessage = typeof input === "string" ? input : JSON.stringify(input);
  const text = await llmCall(
    llmClient.record.config,
    `Feature: ${feature}`,
    userMessage,
    { jsonMode: feature !== "chat" },
  );

  return {
    parsed: extractJSON(text) as T,
    rawText: text,
  };
}

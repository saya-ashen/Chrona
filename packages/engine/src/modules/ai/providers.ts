import { OpenClawClient } from "@chrona/providers-core";
import type { ProviderFeature, ProviderResponse } from "@chrona/providers-core";
import type {
  AiClientRecord,
  AiFeature,
  OpenClawClientConfig,
  LLMClientConfig,
  PreparedAiFeatureSpec,
  StructuredDebugInfo,
} from "@chrona/contracts";
import { AiClientError } from "@chrona/contracts";

const clientCache = new Map<string, OpenClawClient>();

function getClientKey(config: OpenClawClientConfig): string {
  return [config.gatewayUrl, config.gatewayToken, config.model].join(":");
}

export function getOrCreateClient(
  config: OpenClawClientConfig,
): OpenClawClient {
  const key = getClientKey(config);
  const cached = clientCache.get(key);
  if (cached) return cached;
  const gatewayUrl = config.gatewayUrl || config.bridgeUrl;
  const client = new OpenClawClient({
    gatewayUrl,
    gatewayToken: config.gatewayToken ?? config.bridgeToken ?? "",
    model: config.model,
    timeoutSeconds: config.timeoutSeconds,
  });
  clientCache.set(key, client);
  return client;
}

export async function checkClientHealth(
  client: AiClientRecord,
): Promise<{ available: boolean; reason: string }> {
  try {
    if (client.type === "openclaw") {
      const config = client.config as OpenClawClientConfig;
      const openClawClient = new OpenClawClient({
        gatewayUrl: config.gatewayUrl || config.bridgeUrl,
        gatewayToken: config.gatewayToken ?? config.bridgeToken ?? "",
        model: config.model,
        timeoutSeconds: config.timeoutSeconds,
      });
      const healthy = await openClawClient.checkHealth();
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
  client: AiClientRecord,
  feature: AiFeature,
  body: {
    sessionKey?: string;
    instructions?: string;
    inputText?: string;
    featureSpec?: PreparedAiFeatureSpec;
    timeout?: number;
    input?: Record<string, unknown>;
  },
): Promise<string> {
  const config = client.config as OpenClawClientConfig;
  const openClawClient = getOrCreateClient(config);
  const result = await openClawClient.executeFeature(feature, {
    sessionKey: body.sessionKey,
    instructions: body.instructions,
    inputText: body.inputText,
    featureSpec: body.featureSpec,
    timeout: body.timeout,
    ...((body.input as Record<string, unknown>) ?? {}),
  });
  if (result.error) {
    throw new AiClientError(result.error, client.type, "internal");
  }
  return result.output;
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
  config: OpenClawClientConfig,
  feature: AiFeature,
  body: {
    sessionKey?: string;
    instructions?: string;
    inputText?: string;
    featureSpec?: PreparedAiFeatureSpec;
    timeout?: number;
    input?: Record<string, unknown>;
  },
): Promise<string> {
  return openclawFeaturePayload(
    { type: "openclaw", config, enabled: true } as AiClientRecord,
    feature,
    body,
  );
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
  featureSpec?: PreparedAiFeatureSpec;
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

// ────────────────────────────────────────────────────────────────────
// Dispatch helpers (used by feature-normalizers)
// ────────────────────────────────────────────────────────────────────

type FeaturePayloadResult<T> = {
  parsed: T;
  rawText: string;
  debug?: StructuredDebugInfo;
};

async function openclawFeaturePayloadFull<T>(
  client: AiClientRecord,
  feature: AiFeature,
  body: {
    sessionKey?: string;
    instructions?: string;
    inputText?: string;
    featureSpec?: PreparedAiFeatureSpec;
    timeout?: number;
    input?: Record<string, unknown>;
  },
): Promise<FeaturePayloadResult<T>> {
  const config = client.config as OpenClawClientConfig;
  const openClawClient = getOrCreateClient(config);
  const result = (await openClawClient.executeFeature(
    feature as ProviderFeature,
    {
      sessionKey: body.sessionKey,
      instructions: body.instructions,
      inputText: body.inputText,
      timeout: body.timeout,
      ...((body.input as Record<string, unknown>) ?? {}),
    },
  )) as ProviderResponse;

  if (result.error) {
    throw new AiClientError(result.error, client.type, "internal");
  }

  if (result.feature?.payload == null) {
    throw new AiClientError(
      `Feature '${feature}' did not return a parsed payload`,
      client.type,
      "invalid_response",
    );
  }

  return {
    parsed: result.feature.payload as T,
    rawText: result.output,
    debug: {
      rawOutput: result.structured?.rawOutput ?? result.output,
      error: result.structured?.error ?? result.error,
      source: (result.structured?.source ??
        result.feature?.source) as StructuredDebugInfo["source"],
      feature: result.structured?.feature ?? result.feature?.feature ?? null,
      toolName: result.structured?.toolName ?? result.feature?.toolName ?? null,
      sessionId: result.structured?.sessionId ?? result.sessionId,
      runId: result.structured?.runId ?? result.runId,
      validationIssues: result.structured?.validationIssues,
      bridgeToolCalls:
        result.structured?.bridgeToolCalls ??
        result.toolCalls.map((tc) => ({
          tool: tc.tool,
          callId: tc.callId,
          input: tc.input as Record<string, unknown>,
          result: tc.result,
          status: tc.status as "pending" | "completed" | "error",
        })),
    },
  };
}

export async function dispatch(
  client: AiClientRecord,
  feature: AiFeature,
  input: unknown,
  scope = "default",
): Promise<string> {
  if (client.type === "openclaw") {
    const inputText = typeof input === "string" ? input : JSON.stringify(input);
    const inputObj =
      typeof input === "string"
        ? { input }
        : (input as Record<string, unknown>);
    return openclawFeaturePayload(client, feature, {
      sessionKey: scope,
      inputText,
      input: inputObj,
    });
  }
  const userMessage = typeof input === "string" ? input : JSON.stringify(input);
  return llmCall(
    client.config as LLMClientConfig,
    `Feature: ${feature}`,
    userMessage,
    { jsonMode: feature !== "chat" },
  );
}

export async function dispatchFeaturePayload<T = unknown>(
  client: AiClientRecord,
  feature: AiFeature,
  input: unknown,
  scope = "default",
): Promise<FeaturePayloadResult<T>> {
  if (client.type === "openclaw") {
    const inputText = typeof input === "string" ? input : JSON.stringify(input);
    const inputObj =
      typeof input === "string"
        ? { input }
        : (input as Record<string, unknown>);
    return openclawFeaturePayloadFull<T>(client, feature, {
      sessionKey: scope,
      inputText,
      input: inputObj,
    });
  }

  const userMessage = typeof input === "string" ? input : JSON.stringify(input);
  const text = await llmCall(
    client.config as LLMClientConfig,
    `Feature: ${feature}`,
    userMessage,
    { jsonMode: feature !== "chat" },
  );

  return {
    parsed: extractJSON(text) as T,
    rawText: text,
  };
}

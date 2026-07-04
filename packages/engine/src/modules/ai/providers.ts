import { HermesProviderClient } from "@chrona/hermes";
import { CHRONA_CLAUDE_CODE_PROVIDER_TYPE, ClaudeCodeProviderClient } from "@chrona/claude-code";
import { CHRONA_CODEX_PROVIDER_TYPE, CodexProviderClient } from "@chrona/codex";
import { CHRONA_DEBUG_PROVIDER_TYPE, normalizeDebugProviderProfile } from "@chrona/providers-debug";
import type {
  ProviderRunInput,
  ProviderRunEvent,
  ProviderRunSnapshot,
  StartRunInput,
} from "@chrona/providers-foundation";
import type {
  AiClientRecord,
  AiFeature,
  ClaudeCodeClientConfig,
  CodexClientConfig,
  HermesClientConfig,
  LLMClientConfig,
  PreparedAiFeatureSpec,
  StructuredDebugInfo,
  DebugClientConfig,
} from "@chrona/contracts";
import { AiClientError, validatePreparedFeaturePayload } from "@chrona/contracts";
import type { EngineAiClient } from "../../../../../features/ai-clients";
import { aiClientRegistry } from "../../../../../features/ai-clients";

function trimTrailingSlashes(value: string) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
  return value.slice(0, end);
}

const HERMES_API_SERVER_DOCS_URL =
  "https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server";

const HERMES_REQUIRED_CAPABILITIES = [
  { key: "run_submission", label: "run submission (/v1/runs)" },
  { key: "run_status", label: "run status (/v1/runs/{run_id})" },
  { key: "run_events_sse", label: "run event streaming (/v1/runs/{run_id}/events)" },
  { key: "run_stop", label: "run cancellation (/v1/runs/{run_id}/stop)" },
] as const;

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getHermesCapabilityFeatures(
  raw: unknown,
): Record<string, unknown> | null {
  const health = unknownRecord(raw);
  const capabilities = unknownRecord(health?.capabilities);
  return unknownRecord(capabilities?.features);
}

function getMissingHermesCapabilities(raw: unknown): string[] {
  const features = getHermesCapabilityFeatures(raw);
  return HERMES_REQUIRED_CAPABILITIES.filter(
    (capability) => features?.[capability.key] !== true,
  ).map((capability) => capability.label);
}

function hermesCapabilityReason(missing: string[]): string {
  return [
    `Hermes API is reachable, but required capabilities are missing: ${missing.join(", ")}.`,
    "Enable the Hermes API server with API_SERVER_ENABLED=true, set API_SERVER_KEY to the token configured in Chrona, then restart Hermes.",
    `Docs: ${HERMES_API_SERVER_DOCS_URL}`,
  ].join(" ");
}

async function checkClientHealth(
  client: AiClientRecord,
): Promise<{ available: boolean; reason: string }> {
  try {
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

    if (client.type === CHRONA_DEBUG_PROVIDER_TYPE) {
      const config = client.config as DebugClientConfig;
      const profile = normalizeDebugProviderProfile(config.profile);
      return {
        available: true,
        reason: `Chrona debug provider is local (${profile})`,
      };
    }

    if (client.type === "hermes") {
      const config = client.config as HermesClientConfig;
      const health = await new HermesProviderClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        timeoutMs: config.timeoutMs,
      }).checkHealth({ deep: true });

      if (!health.ok) {
        return {
          available: false,
          reason: health.reason ?? health.message ?? "Hermes health check failed",
        };
      }

      const missingCapabilities = getMissingHermesCapabilities(health.raw);
      if (missingCapabilities.length > 0) {
        return {
          available: false,
          reason: hermesCapabilityReason(missingCapabilities),
        };
      }

      return {
        available: true,
        reason: health.reason ?? health.message ?? "Hermes API is reachable",
      };
    }

    if (client.type === CHRONA_CLAUDE_CODE_PROVIDER_TYPE) {
      const config = client.config as ClaudeCodeClientConfig;
      const health = await new ClaudeCodeProviderClient({ config }).checkHealth();
      if (!health.ok) {
        return {
          available: false,
          reason: health.reason ?? health.message ?? "Claude Code health check failed",
        };
      }
      return {
        available: true,
        reason: health.reason ?? health.message ?? "Claude Code connectivity check passed",
      };
    }

    if (client.type === CHRONA_CODEX_PROVIDER_TYPE) {
      const config = client.config as CodexClientConfig;
      const health = await new CodexProviderClient({ config }).checkHealth();
      if (!health.ok) {
        return {
          available: false,
          reason: health.reason ?? health.message ?? "Codex health check failed",
        };
      }
      return {
        available: true,
        reason: health.reason ?? health.message ?? "Codex connectivity check passed",
      };
    }

    return {
      available: false,
      reason: `Provider availability check is not configured for ${client.type}`,
    };
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

  const fencedStart = trimmed.indexOf("```");
  const fencedEnd = fencedStart >= 0 ? trimmed.indexOf("```", fencedStart + 3) : -1;
  const candidate = fencedStart >= 0 && fencedEnd > fencedStart
    ? trimmed.slice(fencedStart + 3, fencedEnd).replace(/^json\s*/i, "").trim()
    : trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1).trim();
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type ProviderFeatureRequest = {
  sessionId: string;
  sessionKey: string;
  instructions: string;
  input: unknown;
  structuredOutputSchema?: PreparedAiFeatureSpec["structuredOutputSchema"];
  terminalToolName?: string;
  stream: boolean;
  maxOutputTokens?: number;
  timeoutSeconds?: number;
};

async function providerFeaturePayload(
  client: EngineAiClient,
  request: ProviderFeatureRequest,
): Promise<string> {
  const providerClient = aiClientRegistry.requireProviderClient(client).providerClient;
  const result = await runProviderRequest(providerClient, request);
  if (result.error) {
    throw new AiClientError(result.error, client.record.type, "internal");
  }
  return result.outputText ?? "";
}

function toStartRunInput(request: ProviderFeatureRequest): StartRunInput {
  return {
    sessionId: request.sessionId,
    sessionKey: request.sessionKey,
    instructions: request.instructions,
    input: request.input as ProviderRunInput,
    structuredOutputSchema: request.structuredOutputSchema,
    terminalToolName: request.terminalToolName,
    maxOutputTokens: request.maxOutputTokens,
    timeoutMs: request.timeoutSeconds
      ? request.timeoutSeconds * 1000
      : undefined,
    stream: true,
  };
}

async function runProviderRequest(
  providerClient: NonNullable<EngineAiClient["providerClient"]>,
  request: ProviderFeatureRequest,
): Promise<ProviderRunSnapshot> {
  let finalSnapshot: ProviderRunSnapshot | null = null;
  try {
    for await (const event of providerClient.streamRun({
      ...toStartRunInput(request),
      stream: true,
    })) {
      if (event.type === "run_completed") {
        finalSnapshot = providerRunCompletedSnapshot(providerClient.provider, event);
      }
      if (event.type === "run_failed") {
        finalSnapshot = providerRunFailedSnapshot(providerClient.provider, request, event);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AiClientError(message, providerClient.provider, "internal");
  }
  if (!finalSnapshot) {
    throw new AiClientError(
      "Provider run finished without a provider snapshot",
      providerClient.provider,
      "invalid_response",
    );
  }
  return finalSnapshot;
}

function providerRunCompletedSnapshot(
  provider: AiClientRecord["type"],
  event: Extract<ProviderRunEvent, { type: "run_completed" }>,
): ProviderRunSnapshot {
  return {
    provider,
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

function providerRunFailedSnapshot(
  provider: AiClientRecord["type"],
  request: ProviderFeatureRequest,
  event: Extract<ProviderRunEvent, { type: "run_failed" }>,
): ProviderRunSnapshot {
  return {
    provider,
    runId: event.run?.runId ?? crypto.randomUUID(),
    nativeRunId: event.run?.nativeRunId,
    sessionId: event.run?.sessionId ?? request.sessionId,
    status: "failed",
    error: event.error,
    raw: event.raw,
  };
}

async function llmFeaturePayload(
  client: AiClientRecord,
  systemPrompt: string,
  userMessage: string,
  options?: { jsonMode?: boolean; temperature?: number },
): Promise<string> {
  const config = client.config as LLMClientConfig;
  const model = config.model ?? "gpt-4o-mini";
  const url = `${trimTrailingSlashes(config.baseUrl)}/chat/completions`;

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

export async function providerCall(
  client: EngineAiClient,
  request: ProviderFeatureRequest,
): Promise<string> {
  return providerFeaturePayload(client, request);
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

export function buildProviderFeatureRequest(input: {
  sessionKey: string;
  input: unknown;
  instructions?: string;
  featureSpec?: PreparedAiFeatureSpec;
  timeoutSeconds?: number;
  stream: boolean;
  maxOutputTokens?: number;
  terminalToolName?: string;
}): ProviderFeatureRequest {
  const fallbackInstructions =
    input.instructions ??
    (typeof input.input === "string" ? input.input : JSON.stringify(input.input));

  const providerInput = input.featureSpec?.inputText
    ? { type: "text" as const, text: input.featureSpec.inputText }
    : input.input;

  return {
    sessionId: input.sessionKey,
    sessionKey: input.sessionKey,
    instructions: input.featureSpec?.instructions ?? fallbackInstructions,
    input: providerInput,
    structuredOutputSchema: input.featureSpec?.structuredOutputSchema,
    terminalToolName: input.terminalToolName,
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

async function providerFeaturePayloadFull<T>(
  client: EngineAiClient,
  feature: AiFeature,
  request: ProviderFeatureRequest,
  featureSpec?: PreparedAiFeatureSpec,
): Promise<FeaturePayloadResult<T>> {
  const providerClient = aiClientRegistry.requireProviderClient(client).providerClient;
  const result = await runProviderRequest(providerClient, request);

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
        featureSpec?.structuredOutputSchema?.name ??
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
  if (client.providerClient) {
    return providerFeaturePayload(client, {
      ...buildProviderFeatureRequest({
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
  if (client.providerClient) {
    return providerFeaturePayloadFull<T>(client, feature, {
      ...buildProviderFeatureRequest({
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

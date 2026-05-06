/**
 * AI Features — Canonical feature implementations.
 */

import { randomUUID } from "node:crypto";

import type {
  AiClientRecord,
  LLMClientConfig,
  SmartSuggestRequest,
  SmartSuggestResponse,
  SmartSuggestion,
  GenerateTaskPlanRequest,
  GenerateTaskPlanResponse,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  ConflictInfo,
  ResolutionSuggestion,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
  TimeslotOption,
  ChatRequest,
  ChatResponse,
  StructuredDebugInfo,
  DispatchTaskInput,
  DispatchTaskOutput,
} from "@chrona/contracts";
import { parseTaskDispatchDecision } from "@chrona/contracts";
import { AiClientError } from "@chrona/contracts";
import { dispatch, dispatchFeaturePayload, extractJSON } from "./providers";
import { buildGeneratePlanScope } from "./streaming";
import type { EditablePlan, PlanBlueprint } from "@chrona/contracts/ai";
import { createLogger } from "@chrona/shared/logger";
import { validateEditablePlan } from "@chrona/domain";

const logger = createLogger("ai-features.features");

function ensureObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiClientError(
      `${context} must be an object`,
      "openclaw",
      "invalid_response",
    );
  }
  return value as Record<string, unknown>;
}

async function parseStructuredFeatureResult<T>(
  client: AiClientRecord,
  feature: Parameters<typeof dispatchFeaturePayload>[1],
  input: Parameters<typeof dispatchFeaturePayload>[2],
  scope = "default",
): Promise<{ parsed: T; debug?: StructuredDebugInfo; rawText?: string }> {
  return dispatchFeaturePayload<T>(client, feature, input, scope);
}

export function normalizeSuggestResponse(input: {
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | null;
}): SmartSuggestResponse {
  const parsed = ensureObject(input.parsed, "suggest result");
  return {
    suggestions: (
      (parsed.suggestions as Array<Partial<SmartSuggestion>> | undefined) ?? []
    )
      .filter((suggestion) => suggestion.title)
      .map((suggestion) => ({
        title: suggestion.title!,
        description: suggestion.description ?? "",
        priority: suggestion.priority ?? "Medium",
        estimatedMinutes: suggestion.estimatedMinutes ?? 30,
        tags: suggestion.tags ?? [],
        suggestedSlot: suggestion.suggestedSlot,
      })),
    source: input.source,
    requestId: randomUUID(),
    structured: input.structured ?? undefined,
  };
}

export async function suggest(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): Promise<SmartSuggestResponse> {
  const result = await parseStructuredFeatureResult<{
    suggestions?: Array<Partial<SmartSuggestion>>;
  }>(client, "suggest", request, request.workspaceId ?? "default");

  return {
    suggestions: (result.parsed.suggestions ?? [])
      .filter((suggestion) => suggestion.title)
      .map((suggestion) => ({
        title: suggestion.title!,
        description: suggestion.description ?? "",
        priority: suggestion.priority ?? "Medium",
        estimatedMinutes: suggestion.estimatedMinutes ?? 30,
        tags: suggestion.tags ?? [],
        suggestedSlot: suggestion.suggestedSlot,
      })),
    source: client.type,
    requestId: randomUUID(),
    structured: result.debug,
  };
}

export function normalizeGeneratePlanResponse(input: {
  parsed: EditablePlan;
  source: string;
  structured?: StructuredDebugInfo | null;
}): GenerateTaskPlanResponse {
  const defaultResult = {
    blueprint: { title: "", goal: "", nodes: [], edges: [] },
    source: input.source,
    structured: input.structured ?? undefined,
  };

  if (!input.parsed || typeof input.parsed !== "object") {
    return defaultResult;
  }

  let aiPlan: PlanBlueprint;
  let warnings: string[] = [];

  try {
    const validation = validateEditablePlan(input.parsed);
    aiPlan = validation.valid;
    warnings = validation.warnings;
  } catch {
    return defaultResult;
  }

  if (warnings.length > 0) {
    logger.warn("plan.validation_warnings", { warnings, source: input.source });
  }

  return {
    blueprint: aiPlan,
    source: input.source,
    structured: input.structured ?? undefined,
  };
}

export async function analyzeConflicts(
  client: AiClientRecord,
  request: AnalyzeConflictsRequest,
): Promise<AnalyzeConflictsResponse> {
  const result = await parseStructuredFeatureResult<{
    conflicts?: ConflictInfo[];
    resolutions?: ResolutionSuggestion[];
    summary?: string;
  }>(client, "conflicts", request, request.workspaceId ?? "default");

  return {
    conflicts: result.parsed.conflicts ?? [],
    resolutions: result.parsed.resolutions ?? [],
    summary: result.parsed.summary ?? "",
    source: client.type,
    structured: result.debug,
  };
}

export async function suggestTimeslots(
  client: AiClientRecord,
  request: SuggestTimeslotRequest,
): Promise<SuggestTimeslotResponse> {
  const result = await parseStructuredFeatureResult<{
    slots?: TimeslotOption[];
    reasoning?: string;
  }>(client, "timeslots", request, request.taskTitle);

  return {
    slots: result.parsed.slots ?? [],
    reasoning: result.parsed.reasoning,
    source: client.type,
    structured: result.debug,
  };
}

export async function chat(
  client: AiClientRecord,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (client.type === "openclaw") {
    if (request.jsonMode) {
      const content = await dispatch(client, "chat", request, "chat");
      return {
        content,
        parsed: extractJSON(content) as unknown,
        source: client.type,
      };
    }

    const raw = await dispatch(client, "chat", request, "chat");
    return { content: raw, source: client.type };
  }

  const config = client.config as LLMClientConfig;
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: request.messages,
    temperature: request.temperature ?? config.temperature ?? 0.7,
  };
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  if (request.jsonMode) body.response_format = { type: "json_object" };

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
  const contentChunks: string[] = [];
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";
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
        if (content) contentChunks.push(content);
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  const content = contentChunks.join("");
  if (request.jsonMode) {
    const parsed = extractJSON(content) as unknown;
    return { content, parsed, source: client.type };
  }
  return { content, source: client.type };
}

export async function dispatchTask(
  client: AiClientRecord,
  request: DispatchTaskInput,
): Promise<DispatchTaskOutput> {
  const result = await parseStructuredFeatureResult<unknown>(
    client,
    "dispatch_task",
    request,
    request.workspaceId,
  );

  const parsed = parseTaskDispatchDecision(result.parsed);
  if (!parsed.ok) {
    throw new AiClientError(
      `Invalid dispatch decision: ${parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
      client.type,
      "invalid_response",
    );
  }

  return {
    decision: parsed.value,
    reliability: "structured_tool_call",
    rawProviderResult: result.rawText,
    structured: result.debug,
  };
}

/**
 * AI Features — Canonical feature implementations.
 */

import { randomUUID } from "node:crypto";

import type {
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
import type { EngineAiClient } from "./runtime/client-registry";
import { requireLlmClient } from "./runtime/client-registry";
import { buildGeneratePlanScope } from "./streaming";
import { type PlanBlueprint, planBlueprintSchema } from "@chrona/contracts/ai";
import { createLogger } from "@chrona/shared/logger";
import type { ZodIssue } from "zod";

function formatZodIssues(
  issues: ZodIssue[],
): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

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

export function normalizeGeneratePlanResponse(input: {
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | null;
}): {
  plan: GenerateTaskPlanResponse;
  validationErrors: Array<{ path: string; message: string }>;
  validationWarnings: Array<{ path: string; message: string }>;
} {
  const defaultResult = {
    blueprint: { title: "", goal: "", nodes: [], edges: [] },
    source: input.source,
    structured: input.structured ?? undefined,
  };

  if (!input.parsed || typeof input.parsed !== "object") {
    return {
      plan: defaultResult,
      validationErrors: [
        { path: "", message: "generate_plan payload must be an object" },
      ],
      validationWarnings: [],
    };
  }

  const parsed = planBlueprintSchema.safeParse(input.parsed);
  if (!parsed.success) {
    return {
      plan: defaultResult,
      validationErrors: formatZodIssues(parsed.error.issues),
      validationWarnings: [],
    };
  }

  return {
    plan: {
      blueprint: parsed.data,
      source: input.source,
      structured: input.structured ?? undefined,
    },
    validationErrors: [],
    validationWarnings: [],
  };
}

export async function chat(
  client: EngineAiClient,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (client.record.type === "openclaw") {
    if (request.jsonMode) {
      const content = await dispatch(client, "chat", request, "chat");
      return {
        content,
        parsed: extractJSON(content) as unknown,
        source: client.record.type,
      };
    }

    const raw = await dispatch(client, "chat", request, "chat");
    return { content: raw, source: client.record.type };
  }

  const llmClient = requireLlmClient(client);
  const config = llmClient.record.config;
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
    return { content, parsed, source: client.record.type };
  }
  return { content, source: client.record.type };
}

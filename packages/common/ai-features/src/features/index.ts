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
} from "../core/types";
import type { StructuredAgentResult } from "../core/structured";
import { parseTaskDispatchDecision } from "../core/dispatch-types";
import { AiClientError } from "../core/types";
import { dispatch, dispatchStructured, extractJSON } from "../core/providers";
import {
  parseDirectStructuredEnvelope,
  requireStructuredResult,
} from "../core/structured";
import { buildGeneratePlanScope } from "../core/streaming";
import type {
  TaskPlanNode,
  TaskPlanEdge,
  TaskPlanNodeType,
  TaskPlanEdgeType,
} from "@/modules/ai/types";

function toStructuredDebugInfo(
  result: ReturnType<typeof requireStructuredResult>,
): StructuredDebugInfo {
  return {
    rawOutput: result.rawOutput,
    error: result.error,
    source: result.source,
    feature: result.feature,
    toolName: result.toolName,
    sessionId: result.sessionId,
    runId: result.runId,
    validationIssues: result.validationIssues,
    bridgeToolCalls: result.bridgeToolCalls,
  };
}

function normalizeNodeType(value: unknown): TaskPlanNodeType {
  switch (value) {
    case "checkpoint":
    case "decision":
    case "user_input":
    case "deliverable":
    case "tool_action":
      return value;
    default:
      return "step";
  }
}

function normalizePriority(
  value: unknown,
): "Low" | "Medium" | "High" | "Urgent" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  if (normalized === "urgent") return "Urgent";
  return null;
}

function normalizeEdgeType(value: unknown): TaskPlanEdgeType {
  switch (value) {
    case "depends_on":
    case "branches_to":
    case "unblocks":
    case "feeds_output":
      return value;
    default:
      return "sequential";
  }
}

function normalizeExecutor(value: unknown): "human" | "automation" | null {
  return value === "human" || value === "automation" ? value : null;
}

function deriveNodeExecution(node: Partial<TaskPlanNode>): {
  executionMode: TaskPlanNode["executionMode"];
  requiresHumanInput: boolean;
  requiresHumanApproval: boolean;
  autoRunnable: boolean;
  blockingReason: TaskPlanNode["blockingReason"];
} {
  const type = normalizeNodeType(node.type);
  const executor = normalizeExecutor((node as Record<string, unknown>).executor);

  const requiresHumanApproval = Boolean(node.requiresHumanApproval);

  const requiresHumanInput =
    Boolean(node.requiresHumanInput) ||
    type === "user_input" ||
    (type === "decision" && !requiresHumanApproval);

  const derivedExecutor =
    executor ??
    (type === "tool_action"
      ? "automation"
      : type === "user_input" || type === "decision" || type === "deliverable"
        ? "human"
        : requiresHumanInput || requiresHumanApproval
          ? "human"
          : "automation");

  const executionMode: TaskPlanNode["executionMode"] =
    derivedExecutor === "human" || requiresHumanInput || requiresHumanApproval
      ? "manual"
      : "automatic";

  const autoRunnable =
    executionMode === "automatic" && !requiresHumanInput && !requiresHumanApproval;

  return {
    executionMode,
    requiresHumanInput,
    requiresHumanApproval,
    autoRunnable,
    blockingReason: requiresHumanInput
      ? ("needs_user_input" as const)
      : requiresHumanApproval
        ? ("needs_approval" as const)
        : null,
  };
}

function ensureObject(value: unknown, context: string): Record<string, unknown> {
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
  feature: Parameters<typeof dispatchStructured>[1],
  input: Parameters<typeof dispatchStructured>[2],
  scope = "default",
): Promise<{ parsed: T; debug?: StructuredDebugInfo; rawText?: string }> {
  if (client.type === "openclaw") {
    const structuredCall = await dispatchStructured<T>(
      client,
      feature,
      input,
      scope,
    );
    const structured = requireStructuredResult<T>(structuredCall, client.type);
    return {
      parsed: structured.parsed as T,
      debug: toStructuredDebugInfo(structured),
      rawText: structured.rawOutput ?? structuredCall.text,
    };
  }

  const raw = await dispatch(client, feature, input, scope);
  return {
    parsed: extractJSON<T>(raw, client.type),
    rawText: raw,
  };
}

export function normalizeSuggestResponse(input: {
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | StructuredAgentResult | null;
}): SmartSuggestResponse {
  const parsed = ensureObject(input.parsed, "suggest result");
  return {
    suggestions: ((parsed.suggestions as Array<Partial<SmartSuggestion>> | undefined) ?? [])
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
  parsed: unknown;
  source: string;
  structured?: StructuredDebugInfo | StructuredAgentResult | null;
}): GenerateTaskPlanResponse {
  const parsed = ensureObject(input.parsed, "task plan result");

  const nodes: TaskPlanNode[] =
    ((parsed.nodes as Array<Partial<TaskPlanNode>> | undefined) ?? []).map(
      (node, index) => {
        const execution = deriveNodeExecution(node);

        return {
          id: node.id ?? `node-${index + 1}`,
          type: normalizeNodeType(node.type),
          title: node.title ?? `Step ${index + 1}`,
          objective: node.objective ?? node.title ?? `Step ${index + 1}`,
          description: node.description ?? null,
          status: "pending" as const,
          phase: node.phase ?? null,
          estimatedMinutes:
            typeof node.estimatedMinutes === "number"
              ? node.estimatedMinutes
              : 30,
          priority: normalizePriority(node.priority),
          executionMode: execution.executionMode,
          requiresHumanInput: execution.requiresHumanInput,
          requiresHumanApproval: execution.requiresHumanApproval,
          autoRunnable: execution.autoRunnable,
          blockingReason: execution.blockingReason,
          linkedTaskId: node.linkedTaskId ?? null,
          completionSummary: node.completionSummary ?? null,
          metadata: node.metadata ?? null,
        };
      },
    );

  const edges: TaskPlanEdge[] =
    ((parsed.edges as Array<Record<string, unknown>> | undefined) ?? []).map(
      (edge, index) => ({
        id: (edge.id as string) ?? `edge-${index + 1}`,
        fromNodeId: (edge.fromNodeId ?? edge.from ?? "") as string,
        toNodeId: (edge.toNodeId ?? edge.to ?? "") as string,
        type: normalizeEdgeType(edge.type),
        metadata: (edge.metadata as Record<string, unknown>) ?? null,
      }),
    );

  return {
    nodes,
    edges,
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : `${nodes.length} planned step${nodes.length === 1 ? "" : "s"}`,
    reasoning:
      typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    source: input.source,
    structured: input.structured ?? undefined,
  };
}

export async function generatePlan(
  client: AiClientRecord,
  request: GenerateTaskPlanRequest,
): Promise<GenerateTaskPlanResponse> {
  const result = await parseStructuredFeatureResult<{
    summary?: string;
    reasoning?: string;
    nodes?: Array<Partial<TaskPlanNode>>;
    edges?: Array<Partial<TaskPlanEdge>>;
  }>(client, "generate_plan", request, buildGeneratePlanScope(request));

  return normalizeGeneratePlanResponse({
    parsed: result.parsed,
    source: client.type,
    structured: result.debug,
  });
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
      const structuredCall = await dispatchStructured<unknown>(
        client,
        "chat",
        request,
        "chat",
      );
      if (structuredCall.structured?.ok) {
        return {
          content: structuredCall.text,
          parsed: structuredCall.structured.parsed,
          source: client.type,
          structured: toStructuredDebugInfo(structuredCall.structured),
        };
      }

      const fallback = parseDirectStructuredEnvelope<unknown>(
        extractJSON<unknown>(structuredCall.text, client.type),
        client.type,
      );
      return {
        content: structuredCall.text,
        parsed: fallback.parsed,
        source: client.type,
        structured: toStructuredDebugInfo(fallback),
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
    const parsed = extractJSON<unknown>(content, client.type);
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
    reliability: result.debug?.source === "assistant_text" ? "fallback_text" : "structured_tool_call",
    rawProviderResult: result.rawText,
    structured: result.debug,
  };
}

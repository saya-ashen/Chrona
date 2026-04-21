/**
 * AI Client — Feature implementations (suggest, generatePlan, conflicts, timeslots, chat).
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
} from "./types";
import { AiClientError } from "./types";
import { dispatch, dispatchStructured, extractJSON } from "./providers";
import { parseDirectStructuredEnvelope, requireStructuredResult } from "./structured";
import type {
  TaskPlanNode,
  TaskPlanEdge,
  TaskPlanNodeType,
  TaskPlanEdgeType,
} from "../types";

function toStructuredDebugInfo(result: ReturnType<typeof requireStructuredResult>): StructuredDebugInfo {
  return {
    rawToolCall: result.rawToolCall,
    rawOutput: result.rawOutput,
    error: result.error,
    status: result.status,
    sessionId: result.sessionId,
    runId: result.runId,
    reliability: result.reliability,
    validationIssues: result.validationIssues,
    structuredEnvelope: result.structured,
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

function normalizePriority(value: unknown): "Low" | "Medium" | "High" | "Urgent" | null {
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

function ensureObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiClientError(`${context} must be an object`, "openclaw", "invalid_response");
  }
  return value as Record<string, unknown>;
}

function parseStructuredFeatureResult<T>(
  client: AiClientRecord,
  feature: Parameters<typeof dispatchStructured>[1],
  message: string,
  scope = "default",
): Promise<{ parsed: T; debug?: StructuredDebugInfo; rawText?: string }> {
  return (async () => {
    if (client.type === "openclaw") {
      const structuredCall = await dispatchStructured<T>(client, feature, message, scope);
      const structured = requireStructuredResult<T>(structuredCall, client.type);
      return {
        parsed: structured.parsed as T,
        debug: toStructuredDebugInfo(structured),
        rawText: structured.rawOutput ?? structuredCall.text,
      };
    }

    const raw = await dispatch(client, feature, message, scope);
    return {
      parsed: extractJSON<T>(raw, client.type),
      rawText: raw,
    };
  })();
}

// ── Suggest ──

export function buildSuggestMessage(request: SmartSuggestRequest): string {
  const contextParts: string[] = [];
  if (request.context?.selectedDay)
    contextParts.push(`Selected day: ${request.context.selectedDay}`);
  if (request.context?.existingTasks?.length) {
    contextParts.push(
      `Existing tasks (${request.context.existingTasks.length}):\n${request.context.existingTasks
        .slice(0, 10)
        .map((t) => `- ${t.title} (${t.status})`)
        .join("\n")}`,
    );
  }
  if (request.context?.scheduleHealth) {
    const h = request.context.scheduleHealth;
    contextParts.push(
      `Schedule: ${h.loadPercent}% load, ${h.conflictCount} conflicts, ${h.freeMinutesToday}min free`,
    );
  }
  return `Suggest task completions for: "${request.input}"${
    contextParts.length ? `\n\nContext:\n${contextParts.join("\n")}` : ""
  }`;
}

export async function suggest(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): Promise<SmartSuggestResponse> {
  const requestId = randomUUID();
  const result = await parseStructuredFeatureResult<{ suggestions?: Array<Partial<SmartSuggestion>> }>(
    client,
    "suggest",
    buildSuggestMessage(request),
    request.workspaceId ?? "default",
  );

  return {
    suggestions: (result.parsed.suggestions ?? [])
      .filter((s) => s.title)
      .map((s) => ({
        title: s.title!,
        description: s.description ?? "",
        priority: s.priority ?? "Medium",
        estimatedMinutes: s.estimatedMinutes ?? 30,
        tags: s.tags ?? [],
        suggestedSlot: s.suggestedSlot,
      })),
    source: client.type,
    requestId,
    structured: result.debug,
  };
}

// ── Generate Plan ──

export async function generatePlan(
  client: AiClientRecord,
  request: GenerateTaskPlanRequest,
): Promise<GenerateTaskPlanResponse> {
  const msg = `Generate an executable task plan graph for:\nTitle: "${request.title}"${
    request.description ? `\nDescription: ${request.description}` : ""
  }${request.estimatedMinutes ? `\nEstimated: ${request.estimatedMinutes} min` : ""}`;

  const result = await parseStructuredFeatureResult<{
    summary?: string;
    reasoning?: string;
    nodes?: Array<Partial<TaskPlanNode>>;
    edges?: Array<Partial<TaskPlanEdge>>;
  }>(client, "generate_plan", msg, request.taskId);

  const parsed = ensureObject(result.parsed, "task plan result");

  const nodes: TaskPlanNode[] = ((parsed.nodes as Array<Partial<TaskPlanNode>> | undefined) ?? []).map((n, i) => {
    const execMode = n.executionMode === "manual" || n.executionMode === "hybrid"
      ? n.executionMode
      : "automatic";
    const requiresInput = Boolean(n.requiresHumanInput);
    const requiresApproval = Boolean(n.requiresHumanApproval);
    const autoRunnable = execMode === "automatic" && !requiresInput && !requiresApproval;

    return {
      id: n.id ?? `node-${i + 1}`,
      type: normalizeNodeType(n.type),
      title: n.title ?? `Step ${i + 1}`,
      objective: n.objective ?? n.title ?? `Step ${i + 1}`,
      description: n.description ?? null,
      status: "pending" as const,
      phase: n.phase ?? null,
      estimatedMinutes: typeof n.estimatedMinutes === "number" ? n.estimatedMinutes : 30,
      priority: normalizePriority(n.priority),
      executionMode: execMode,
      requiresHumanInput: requiresInput,
      requiresHumanApproval: requiresApproval,
      autoRunnable,
      blockingReason: requiresInput ? "needs_user_input" as const : requiresApproval ? "needs_approval" as const : null,
      linkedTaskId: n.linkedTaskId ?? null,
      metadata: n.metadata ?? null,
    };
  });

  const edges: TaskPlanEdge[] = ((parsed.edges as Array<Record<string, unknown>> | undefined) ?? []).map((e, i) => ({
    id: (e.id as string) ?? `edge-${i + 1}`,
    fromNodeId: (e.fromNodeId ?? e.from ?? "") as string,
    toNodeId: (e.toNodeId ?? e.to ?? "") as string,
    type: normalizeEdgeType(e.type),
    metadata: (e.metadata as Record<string, unknown>) ?? null,
  }));

  return {
    nodes,
    edges,
    summary: typeof parsed.summary === "string" ? parsed.summary : `${nodes.length} planned step${nodes.length === 1 ? "" : "s"}`,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    source: client.type,
    structured: result.debug,
  };
}

// ── Analyze Conflicts ──

export async function analyzeConflicts(
  client: AiClientRecord,
  request: AnalyzeConflictsRequest,
): Promise<AnalyzeConflictsResponse> {
  const taskList = request.tasks
    .map(
      (t) =>
        `- ${t.id}: "${t.title}" ${t.scheduledStartAt ?? "?"}~${t.scheduledEndAt ?? "?"} ${t.priority ?? "Medium"}`,
    )
    .join("\n");
  const msg = `Analyze conflicts:\n${taskList}${request.focusDate ? `\nFocus date: ${request.focusDate}` : ""}`;

  const result = await parseStructuredFeatureResult<{
    conflicts?: ConflictInfo[];
    resolutions?: ResolutionSuggestion[];
    summary?: string;
  }>(client, "conflicts", msg, request.workspaceId ?? "default");

  return {
    conflicts: result.parsed.conflicts ?? [],
    resolutions: result.parsed.resolutions ?? [],
    summary: result.parsed.summary ?? "",
    source: client.type,
    structured: result.debug,
  };
}

// ── Suggest Timeslots ──

export async function suggestTimeslots(
  client: AiClientRecord,
  request: SuggestTimeslotRequest,
): Promise<SuggestTimeslotResponse> {
  const scheduleList = request.currentSchedule
    .filter((t) => t.scheduledStartAt)
    .map((t) => `- "${t.title}" ${t.scheduledStartAt}~${t.scheduledEndAt}`)
    .join("\n");
  const msg = `Find time slots for:\nTask: "${request.taskTitle}" (${request.estimatedMinutes} min, ${request.priority ?? "Medium"})${
    request.deadline ? `\nDeadline: ${request.deadline}` : ""
  }\nWork hours: ${request.preferences?.workdayStartHour ?? 9}:00-${request.preferences?.workdayEndHour ?? 18}:00\n\nCurrent schedule:\n${scheduleList || "(empty)"}`;

  const result = await parseStructuredFeatureResult<{ slots?: TimeslotOption[]; reasoning?: string }>(
    client,
    "timeslots",
    msg,
    request.taskTitle,
  );

  return {
    slots: result.parsed.slots ?? [],
    reasoning: result.parsed.reasoning,
    source: client.type,
    structured: result.debug,
  };
}

// ── Chat ──

export async function chat(
  client: AiClientRecord,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (client.type === "openclaw") {
    const lastUserMsg =
      [...request.messages].reverse().find((m) => m.role === "user")?.content ??
      "";

    if (request.jsonMode) {
      const structuredCall = await dispatchStructured<unknown>(client, "chat", lastUserMsg);
      if (structuredCall.structured?.structured) {
        return {
          content: structuredCall.text,
          parsed: structuredCall.structured.parsed,
          source: client.type,
          structured: toStructuredDebugInfo(structuredCall.structured),
        };
      }

      const fallback = parseDirectStructuredEnvelope<unknown>(extractJSON<unknown>(structuredCall.text, client.type), client.type);
      return {
        content: structuredCall.text,
        parsed: fallback.parsed,
        source: client.type,
        structured: toStructuredDebugInfo(fallback),
      };
    }

    const raw = await dispatch(client, "chat", lastUserMsg);
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
    throw new AiClientError("No response body for streaming", "llm", "internal");
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
        const c = parsed.choices?.[0]?.delta?.content;
        if (c) contentChunks.push(c);
      } catch {
        // skip
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

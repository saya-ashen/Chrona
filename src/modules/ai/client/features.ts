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
} from "./types";
import { AiClientError } from "./types";
import { dispatch, extractJSON } from "./providers";
import type {
  TaskPlanNode,
  TaskPlanEdge,
  TaskPlanNodeType,
  TaskPlanEdgeType,
} from "../types";

// ── Helpers ──

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
  }\n\nReturn JSON: { "suggestions": [...] }`;
}

export async function suggest(
  client: AiClientRecord,
  request: SmartSuggestRequest,
): Promise<SmartSuggestResponse> {
  const requestId = randomUUID();
  const raw = await dispatch(
    client,
    "suggest",
    buildSuggestMessage(request),
    request.workspaceId ?? "default",
  );
  const parsed = extractJSON<{ suggestions?: Array<Partial<SmartSuggestion>> }>(
    raw,
    client.type,
  );
  return {
    suggestions: (parsed.suggestions ?? [])
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
  };
}

// ── Generate Plan ──

export async function generatePlan(
  client: AiClientRecord,
  request: GenerateTaskPlanRequest,
): Promise<GenerateTaskPlanResponse> {
  const msg = `Generate an executable task plan graph for:\nTitle: "${request.title}"${
    request.description ? `\nDescription: ${request.description}` : ""
  }${request.estimatedMinutes ? `\nEstimated: ${request.estimatedMinutes} min` : ""}\n\nReturn JSON.`;
  const raw = await dispatch(client, "generate_plan", msg);
  const parsed = extractJSON<{
    summary?: string;
    reasoning?: string;
    nodes?: Array<Partial<TaskPlanNode>>;
    edges?: Array<Partial<TaskPlanEdge>>;
  }>(raw, client.type);
  
  const nodes: TaskPlanNode[] = (parsed.nodes ?? []).map((n, i) => {
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
  
  const edges: TaskPlanEdge[] = (parsed.edges ?? []).map((e, i) => ({
    id: e.id ?? `edge-${i + 1}`,
    fromNodeId: e.fromNodeId ?? "",
    toNodeId: e.toNodeId ?? "",
    type: normalizeEdgeType(e.type),
    metadata: e.metadata ?? null,
  }));
  
  return {
    nodes,
    edges,
    summary: parsed.summary ?? `${nodes.length} planned step${nodes.length === 1 ? "" : "s"}`,
    reasoning: parsed.reasoning,
    source: client.type,
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
  const msg = `Analyze conflicts:\n${taskList}${request.focusDate ? `\nFocus date: ${request.focusDate}` : ""}\n\nReturn JSON.`;
  const raw = await dispatch(
    client,
    "conflicts",
    msg,
    request.workspaceId ?? "default",
  );
  const parsed = extractJSON<{
    conflicts?: ConflictInfo[];
    resolutions?: ResolutionSuggestion[];
    summary?: string;
  }>(raw, client.type);
  return {
    conflicts: parsed.conflicts ?? [],
    resolutions: parsed.resolutions ?? [],
    summary: parsed.summary ?? "",
    source: client.type,
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
  }\nWork hours: ${request.preferences?.workdayStartHour ?? 9}:00-${request.preferences?.workdayEndHour ?? 18}:00\n\nCurrent schedule:\n${scheduleList || "(empty)"}\n\nReturn JSON.`;
  const raw = await dispatch(client, "timeslots", msg);
  const parsed = extractJSON<{ slots?: TimeslotOption[]; reasoning?: string }>(
    raw,
    client.type,
  );
  return {
    slots: parsed.slots ?? [],
    reasoning: parsed.reasoning,
    source: client.type,
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
    const raw = await dispatch(client, "chat", lastUserMsg);
    if (request.jsonMode) {
      const parsed = extractJSON<unknown>(raw, client.type);
      return { content: raw, parsed, source: client.type };
    }
    return { content: raw, source: client.type };
  }

  // LLM — use full message history
  const config = client.config as LLMClientConfig;
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
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
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(
      `LLM returned ${res.status}: ${errText.slice(0, 200)}`,
      "llm",
      "internal",
    );
  }

  interface LLMChatCompletionResponse {
    choices: Array<{ message: { content: string } }>;
  }

  const data = (await res.json()) as LLMChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content ?? "";
  console.log(
    `[LLM Chat] User: ${request.messages.map((m) => `${m.role}: ${m.content}`).join(" | ")} => Assistant: ${content}`,
  );

  if (request.jsonMode) {
    const parsed = extractJSON<unknown>(content, client.type);
    return { content, parsed, source: client.type };
  }
  return { content, source: client.type };
}

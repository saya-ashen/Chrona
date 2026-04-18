/**
 * AI Client — Unified module for all AI interactions.
 *
 * No adapter abstraction. Two client types:
 *   - "openclaw": calls OpenClaw CLI Bridge HTTP server
 *   - "llm": calls OpenAI-compatible chat completion API
 *
 * Clients are stored in the database (AiClient model).
 * Features are bound to specific clients via AiFeatureBinding.
 */

import { randomUUID } from "node:crypto";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type AiClientType = "openclaw" | "llm";
export type AiFeature = "suggest" | "decompose" | "conflicts" | "timeslots" | "chat";

export interface AiClientRecord {
  id: string;
  name: string;
  type: AiClientType;
  config: OpenClawClientConfig | LLMClientConfig;
  isDefault: boolean;
  enabled: boolean;
}

export interface OpenClawClientConfig {
  bridgeUrl: string;
  timeoutSeconds?: number;
}

export interface LLMClientConfig {
  baseUrl: string;
  apiKey: string;
  model?: string;
  temperature?: number;
}

// ── Request / Response ──

export interface TaskSnapshot {
  id: string;
  title: string;
  status: string;
  priority?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  estimatedMinutes?: number;
  dueAt?: string;
  tags?: string[];
}

export interface ScheduleHealthSnapshot {
  totalTasks: number;
  scheduledTasks: number;
  overdueTasks: number;
  conflictCount: number;
  loadPercent: number;
  freeMinutesToday: number;
}

export interface SmartSuggestRequest {
  input: string;
  kind: "auto-complete" | "schedule" | "general";
  workspaceId?: string;
  context?: {
    existingTasks?: TaskSnapshot[];
    selectedDay?: string;
    scheduledMinutesToday?: number;
    scheduleHealth?: ScheduleHealthSnapshot;
    [key: string]: unknown;
  };
}

export interface SmartSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
  suggestedSlot?: { startAt: string; endAt: string };
}

export interface SmartSuggestResponse {
  suggestions: SmartSuggestion[];
  source: string;
  requestId: string;
}

export interface DecomposeTaskRequest {
  taskId: string;
  title: string;
  description?: string;
  estimatedMinutes?: number;
}

export interface SubtaskSuggestion {
  title: string;
  description?: string;
  estimatedMinutes?: number;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  order: number;
  dependsOn?: number[];
}

export interface DecomposeTaskResponse {
  subtasks: SubtaskSuggestion[];
  reasoning?: string;
  source: string;
}

export interface AnalyzeConflictsRequest {
  tasks: TaskSnapshot[];
  workspaceId?: string;
  focusDate?: string;
}

export interface ConflictInfo {
  id: string;
  type: "time_overlap" | "overload" | "fragmentation" | "dependency";
  severity: "low" | "medium" | "high";
  taskIds: string[];
  description: string;
}

export interface ResolutionSuggestion {
  conflictId: string;
  type: "reschedule" | "split" | "merge" | "defer" | "reorder";
  description: string;
  reason: string;
  changes: Array<{ taskId: string; scheduledStartAt?: string; scheduledEndAt?: string }>;
}

export interface AnalyzeConflictsResponse {
  conflicts: ConflictInfo[];
  resolutions: ResolutionSuggestion[];
  summary: string;
  source: string;
}

export interface SuggestTimeslotRequest {
  taskTitle: string;
  estimatedMinutes: number;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  deadline?: string;
  currentSchedule: TaskSnapshot[];
  preferences?: {
    workdayStartHour?: number;
    workdayEndHour?: number;
    bufferMinutes?: number;
    preferMorning?: boolean;
  };
}

export interface TimeslotOption {
  startAt: string;
  endAt: string;
  score: number;
  reason: string;
}

export interface SuggestTimeslotResponse {
  slots: TimeslotOption[];
  reasoning?: string;
  source: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  parsed?: unknown;
  source: string;
}

export class AiClientError extends Error {
  constructor(
    message: string,
    public readonly clientType: string,
    public readonly code: "unavailable" | "timeout" | "invalid_response" | "config_error" | "internal",
  ) {
    super(`[${clientType}] ${message}`);
    this.name = "AiClientError";
  }
}

// ────────────────────────────────────────────────────────────────────
// System Prompts
// ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<AiFeature, string> = {
  suggest: `You are a smart scheduling assistant for a task planning application.
When given a partial task title and context, generate 2-4 task suggestions.
Return valid JSON only (no markdown wrapping):
{"suggestions":[{"title":"...","description":"...","priority":"Low|Medium|High|Urgent","estimatedMinutes":N,"tags":[],"suggestedSlot":{"startAt":"ISO","endAt":"ISO"}}]}
Respond in the same language as the input.`,

  decompose: `You are a task decomposition assistant. Break the given task into 2-8 actionable subtasks.
Return JSON only:
{"subtasks":[{"title":"...","description":"...","estimatedMinutes":N,"priority":"...","order":N,"dependsOn":[]}],"reasoning":"..."}
Respond in the same language as the input.`,

  conflicts: `You are a schedule conflict analyzer. Find conflicts and suggest resolutions.
Return JSON only:
{"conflicts":[{"id":"...","type":"time_overlap|overload|fragmentation|dependency","severity":"low|medium|high","taskIds":[],"description":"..."}],"resolutions":[{"conflictId":"...","type":"reschedule|split|merge|defer|reorder","description":"...","reason":"...","changes":[{"taskId":"...","scheduledStartAt":"...","scheduledEndAt":"..."}]}],"summary":"..."}`,

  timeslots: `You are a scheduling optimizer. Suggest optimal time slots for a task.
Return JSON only:
{"slots":[{"startAt":"ISO","endAt":"ISO","score":0.0-1.0,"reason":"..."}],"reasoning":"..."}`,

  chat: `You are a helpful scheduling assistant with access to the user's task and schedule data.
Respond in the same language as the user.`,
};

// ────────────────────────────────────────────────────────────────────
// JSON Parsing Utility
// ────────────────────────────────────────────────────────────────────

function extractJSON<T>(raw: string, clientType: string): T {
  const jsonMatch =
    raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ??
    raw.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? raw;
  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    throw new AiClientError(
      `Failed to parse JSON: ${raw.slice(0, 200)}`,
      clientType,
      "invalid_response",
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// OpenClaw Client (calls CLI Bridge HTTP)
// ────────────────────────────────────────────────────────────────────

interface BridgeChatResponse {
  sessionId: string;
  output: string;
  toolCalls: Array<{ tool: string; callId: string; input: Record<string, unknown>; result?: string; status: string }>;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
  durationMs: number;
}

async function openclawCall(
  config: OpenClawClientConfig,
  feature: AiFeature,
  scope: string,
  userMessage: string,
): Promise<string> {
  const timeout = config.timeoutSeconds ?? 120;
  const sessionId = `ai::${feature}::${scope}`;

  const res = await fetch(`${config.bridgeUrl}/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      message: userMessage,
      systemPrompt: SYSTEM_PROMPTS[feature],
      timeout,
    }),
    signal: AbortSignal.timeout((timeout + 15) * 1000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(`Bridge returned ${res.status}: ${errText.slice(0, 200)}`, "openclaw", "internal");
  }

  const result = (await res.json()) as BridgeChatResponse;
  if (result.error) {
    throw new AiClientError(result.error, "openclaw", "internal");
  }
  return result.output;
}

async function openclawHealthCheck(config: OpenClawClientConfig): Promise<boolean> {
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

// ────────────────────────────────────────────────────────────────────
// LLM Client (OpenAI-compatible)
// ────────────────────────────────────────────────────────────────────

interface LLMChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function llmCall(
  config: LLMClientConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { jsonMode?: boolean; temperature?: number; maxTokens?: number },
): Promise<string> {
  const model = config.model ?? "gpt-4o-mini";
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
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
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(`LLM returned ${res.status}: ${errText.slice(0, 200)}`, "llm", "internal");
  }

  const data = (await res.json()) as LLMChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

function llmHealthCheck(config: LLMClientConfig): boolean {
  return Boolean(config.baseUrl && config.apiKey);
}

// ────────────────────────────────────────────────────────────────────
// Unified Dispatch
// ────────────────────────────────────────────────────────────────────

async function dispatch(
  client: AiClientRecord,
  feature: AiFeature,
  userMessage: string,
  scope = "default",
): Promise<string> {
  if (client.type === "openclaw") {
    return openclawCall(client.config as OpenClawClientConfig, feature, scope, userMessage);
  }
  return llmCall(
    client.config as LLMClientConfig,
    SYSTEM_PROMPTS[feature],
    userMessage,
    { jsonMode: feature !== "chat" },
  );
}

// ────────────────────────────────────────────────────────────────────
// Feature Implementations
// ────────────────────────────────────────────────────────────────────

export function buildSuggestMessage(request: SmartSuggestRequest): string {
  const contextParts: string[] = [];
  if (request.context?.selectedDay) contextParts.push(`Selected day: ${request.context.selectedDay}`);
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
    contextParts.push(`Schedule: ${h.loadPercent}% load, ${h.conflictCount} conflicts, ${h.freeMinutesToday}min free`);
  }
  return `Suggest task completions for: "${request.input}"${
    contextParts.length ? `\n\nContext:\n${contextParts.join("\n")}` : ""
  }\n\nReturn JSON: { "suggestions": [...] }`;
}

export async function suggest(client: AiClientRecord, request: SmartSuggestRequest): Promise<SmartSuggestResponse> {
  const requestId = randomUUID();
  const raw = await dispatch(client, "suggest", buildSuggestMessage(request), request.workspaceId ?? "default");
  const parsed = extractJSON<{ suggestions?: Array<Partial<SmartSuggestion>> }>(raw, client.type);
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

export async function decompose(client: AiClientRecord, request: DecomposeTaskRequest): Promise<DecomposeTaskResponse> {
  const msg = `Decompose this task:\nTitle: "${request.title}"${
    request.description ? `\nDescription: ${request.description}` : ""
  }${request.estimatedMinutes ? `\nEstimated: ${request.estimatedMinutes} min` : ""}\n\nReturn JSON.`;
  const raw = await dispatch(client, "decompose", msg);
  const parsed = extractJSON<{ subtasks?: Array<Partial<SubtaskSuggestion>>; reasoning?: string }>(raw, client.type);
  return {
    subtasks: (parsed.subtasks ?? []).map((s, i) => ({
      title: s.title ?? `Subtask ${i + 1}`,
      description: s.description,
      estimatedMinutes: s.estimatedMinutes,
      priority: s.priority,
      order: s.order ?? i + 1,
      dependsOn: s.dependsOn,
    })),
    reasoning: parsed.reasoning,
    source: client.type,
  };
}

export async function analyzeConflicts(client: AiClientRecord, request: AnalyzeConflictsRequest): Promise<AnalyzeConflictsResponse> {
  const taskList = request.tasks
    .map((t) => `- ${t.id}: "${t.title}" ${t.scheduledStartAt ?? "?"}~${t.scheduledEndAt ?? "?"} ${t.priority ?? "Medium"}`)
    .join("\n");
  const msg = `Analyze conflicts:\n${taskList}${request.focusDate ? `\nFocus date: ${request.focusDate}` : ""}\n\nReturn JSON.`;
  const raw = await dispatch(client, "conflicts", msg, request.workspaceId ?? "default");
  const parsed = extractJSON<{ conflicts?: ConflictInfo[]; resolutions?: ResolutionSuggestion[]; summary?: string }>(raw, client.type);
  return {
    conflicts: parsed.conflicts ?? [],
    resolutions: parsed.resolutions ?? [],
    summary: parsed.summary ?? "",
    source: client.type,
  };
}

export async function suggestTimeslots(client: AiClientRecord, request: SuggestTimeslotRequest): Promise<SuggestTimeslotResponse> {
  const scheduleList = request.currentSchedule
    .filter((t) => t.scheduledStartAt)
    .map((t) => `- "${t.title}" ${t.scheduledStartAt}~${t.scheduledEndAt}`)
    .join("\n");
  const msg = `Find time slots for:\nTask: "${request.taskTitle}" (${request.estimatedMinutes} min, ${request.priority ?? "Medium"})${
    request.deadline ? `\nDeadline: ${request.deadline}` : ""
  }\nWork hours: ${request.preferences?.workdayStartHour ?? 9}:00-${request.preferences?.workdayEndHour ?? 18}:00\n\nCurrent schedule:\n${scheduleList || "(empty)"}\n\nReturn JSON.`;
  const raw = await dispatch(client, "timeslots", msg);
  const parsed = extractJSON<{ slots?: TimeslotOption[]; reasoning?: string }>(raw, client.type);
  return {
    slots: parsed.slots ?? [],
    reasoning: parsed.reasoning,
    source: client.type,
  };
}

export async function chat(client: AiClientRecord, request: ChatRequest): Promise<ChatResponse> {
  if (client.type === "openclaw") {
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new AiClientError(`LLM returned ${res.status}: ${errText.slice(0, 200)}`, "llm", "internal");
  }

  const data = (await res.json()) as LLMChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content ?? "";

  if (request.jsonMode) {
    const parsed = extractJSON<unknown>(content, client.type);
    return { content, parsed, source: client.type };
  }
  return { content, source: client.type };
}

// ────────────────────────────────────────────────────────────────────
// Health Check
// ────────────────────────────────────────────────────────────────────

export async function checkClientHealth(client: AiClientRecord): Promise<boolean> {
  if (!client.enabled) return false;
  if (client.type === "openclaw") {
    return openclawHealthCheck(client.config as OpenClawClientConfig);
  }
  return llmHealthCheck(client.config as LLMClientConfig);
}

/**
 * AI Client — Feature implementations (suggest, decompose, conflicts, timeslots, chat).
 */

import { randomUUID } from "node:crypto";

import type {
  AiClientRecord,
  LLMClientConfig,
  SmartSuggestRequest,
  SmartSuggestResponse,
  SmartSuggestion,
  DecomposeTaskRequest,
  DecomposeTaskResponse,
  SubtaskSuggestion,
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

// ── Decompose ──

export async function decompose(
  client: AiClientRecord,
  request: DecomposeTaskRequest,
): Promise<DecomposeTaskResponse> {
  const msg = `Decompose this task:\nTitle: "${request.title}"${
    request.description ? `\nDescription: ${request.description}` : ""
  }${request.estimatedMinutes ? `\nEstimated: ${request.estimatedMinutes} min` : ""}\n\nReturn JSON.`;
  const raw = await dispatch(client, "decompose", msg);
  const parsed = extractJSON<{
    subtasks?: Array<Partial<SubtaskSuggestion>>;
    reasoning?: string;
  }>(raw, client.type);
  return {
    subtasks: (parsed.subtasks ?? []).map((s, i) => ({
      title: s.title ?? `Subtask ${i + 1}`,
      description: s.description,
      estimatedMinutes: s.estimatedMinutes ?? 30,
      priority: s.priority ?? "Medium",
      order: s.order ?? i + 1,
      dependsOnPrevious: i > 0,
    })),
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

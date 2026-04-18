/**
 * OpenClaw Adapter — AI via OpenClaw CLI Bridge HTTP service.
 *
 * Instead of connecting to OpenClaw Gateway via WebSocket, this adapter
 * calls the OpenClaw CLI Bridge (a lightweight HTTP server that spawns
 * `openclaw agent --local --json` subprocesses).
 *
 * The bridge should be running on the same machine as OpenClaw.
 * Default URL: http://localhost:7677
 *
 * Advantages:
 *   - Simple HTTP — no WebSocket connection management
 *   - CLI has full local access to OpenClaw tools
 *   - Session persistence via --session-id
 *   - Works without gateway configuration
 */

import { randomUUID } from "node:crypto";
import { AIAdapter } from "./base";
import type {
  AIAdapterCapabilities,
  AIAdapterConfig,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  ChatRequest,
  ChatResponse,
  ConflictInfo,
  DecomposeTaskRequest,
  DecomposeTaskResponse,
  ResolutionSuggestion,
  SmartSuggestRequest,
  SmartSuggestResponse,
  SmartSuggestion,
  SubtaskSuggestion,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
  TimeslotOption,
} from "./types";
import { AIAdapterError } from "./types";

// ────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────

export interface OpenClawAdapterOptions {
  /** Bridge HTTP URL (default: http://localhost:7677) */
  bridgeUrl?: string;
  /** Default timeout in seconds for CLI execution */
  timeoutSeconds?: number;
}

// ────────────────────────────────────────────────────────────────────
// Bridge response type
// ────────────────────────────────────────────────────────────────────

interface BridgeChatResponse {
  sessionId: string;
  output: string;
  toolCalls: Array<{
    tool: string;
    callId: string;
    input: Record<string, unknown>;
    result?: string;
    status: string;
  }>;
  usage: { inputTokens: number; outputTokens: number } | null;
  error: string | null;
  durationMs: number;
}

// ────────────────────────────────────────────────────────────────────
// Session naming
// ────────────────────────────────────────────────────────────────────

type SessionPurpose = "suggest" | "decompose" | "conflicts" | "timeslots" | "chat";

function buildSessionKey(purpose: SessionPurpose, scope: string): string {
  return `ai::${purpose}::${scope}`;
}

// ────────────────────────────────────────────────────────────────────
// System Prompts
// ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<SessionPurpose, string> = {
  suggest: `You are a smart scheduling assistant for a task planning application.
When given a partial task title and context, generate 2-4 task suggestions.
You have access to tools — use them to check existing tasks and schedule load.
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
// Adapter Implementation
// ────────────────────────────────────────────────────────────────────

export class OpenClawAdapter extends AIAdapter {
  private options: OpenClawAdapterOptions;

  constructor(config: AIAdapterConfig) {
    super(config);
    this.options = (config.options ?? {}) as OpenClawAdapterOptions;
  }

  get type(): string {
    return "openclaw";
  }

  private get bridgeUrl(): string {
    return (
      this.options.bridgeUrl ??
      process.env.OPENCLAW_BRIDGE_URL ??
      "http://localhost:7677"
    );
  }

  capabilities(): AIAdapterCapabilities {
    return {
      toolCalling: true,
      structuredOutput: true,
      streaming: true,
      persistentContext: true,
      codeExecution: true,
      sessions: true,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.bridgeUrl}/v1/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { status: string };
      return body.status === "ok";
    } catch {
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Bridge communication
  // ──────────────────────────────────────────────────────────────────

  private async callBridge(
    purpose: SessionPurpose,
    scope: string,
    userMessage: string,
  ): Promise<string> {
    const sessionId = buildSessionKey(purpose, scope);
    const timeout = this.options.timeoutSeconds ?? 120;

    const res = await fetch(`${this.bridgeUrl}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        message: userMessage,
        systemPrompt: SYSTEM_PROMPTS[purpose],
        timeout,
      }),
      signal: AbortSignal.timeout((timeout + 15) * 1000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AIAdapterError(
        `Bridge returned ${res.status}: ${errText.slice(0, 200)}`,
        this.type,
        "internal",
      );
    }

    const result = (await res.json()) as BridgeChatResponse;

    if (result.error) {
      throw new AIAdapterError(result.error, this.type, "internal");
    }

    return result.output;
  }

  private parseJSON<T>(raw: string): T {
    const jsonMatch =
      raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ??
      raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch?.[1] ?? raw;
    try {
      return JSON.parse(jsonStr.trim()) as T;
    } catch {
      throw new AIAdapterError(
        `Failed to parse JSON: ${raw.slice(0, 200)}`,
        this.type,
        "invalid_response",
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Smart Suggest
  // ──────────────────────────────────────────────────────────────────

  async suggest(request: SmartSuggestRequest): Promise<SmartSuggestResponse> {
    const requestId = randomUUID();
    const scope = request.workspaceId ?? "default";

    const contextParts: string[] = [];
    if (request.context?.selectedDay) {
      contextParts.push(`Selected day: ${request.context.selectedDay}`);
    }
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

    const userMessage = `Suggest task completions for: "${request.input}"${
      contextParts.length ? `\n\nContext:\n${contextParts.join("\n")}` : ""
    }\n\nReturn JSON: { "suggestions": [...] }`;

    const raw = await this.callBridge("suggest", scope, userMessage);
    const parsed = this.parseJSON<{ suggestions?: Array<Partial<SmartSuggestion>> }>(raw);

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
      source: this.type,
      requestId,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Task Decomposition
  // ──────────────────────────────────────────────────────────────────

  async decompose(request: DecomposeTaskRequest): Promise<DecomposeTaskResponse> {
    const userMessage = `Decompose this task:\nTitle: "${request.title}"${
      request.description ? `\nDescription: ${request.description}` : ""
    }${request.estimatedMinutes ? `\nEstimated: ${request.estimatedMinutes} min` : ""}\n\nReturn JSON.`;

    const raw = await this.callBridge("decompose", "default", userMessage);
    const parsed = this.parseJSON<{
      subtasks?: Array<Partial<SubtaskSuggestion>>;
      reasoning?: string;
    }>(raw);

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
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Conflict Analysis
  // ──────────────────────────────────────────────────────────────────

  async analyzeConflicts(request: AnalyzeConflictsRequest): Promise<AnalyzeConflictsResponse> {
    const taskList = request.tasks
      .map((t) => `- ${t.id}: "${t.title}" ${t.scheduledStartAt ?? "?"}~${t.scheduledEndAt ?? "?"} ${t.priority ?? "Medium"}`)
      .join("\n");

    const userMessage = `Analyze conflicts:\n${taskList}${
      request.focusDate ? `\nFocus date: ${request.focusDate}` : ""
    }\n\nReturn JSON.`;

    const raw = await this.callBridge("conflicts", request.workspaceId ?? "default", userMessage);
    const parsed = this.parseJSON<{
      conflicts?: ConflictInfo[];
      resolutions?: ResolutionSuggestion[];
      summary?: string;
    }>(raw);

    return {
      conflicts: parsed.conflicts ?? [],
      resolutions: parsed.resolutions ?? [],
      summary: parsed.summary ?? "",
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Timeslot Suggestion
  // ──────────────────────────────────────────────────────────────────

  async suggestTimeslots(request: SuggestTimeslotRequest): Promise<SuggestTimeslotResponse> {
    const scheduleList = request.currentSchedule
      .filter((t) => t.scheduledStartAt)
      .map((t) => `- "${t.title}" ${t.scheduledStartAt}~${t.scheduledEndAt}`)
      .join("\n");

    const userMessage = `Find time slots for:\nTask: "${request.taskTitle}" (${request.estimatedMinutes} min, ${request.priority ?? "Medium"})${
      request.deadline ? `\nDeadline: ${request.deadline}` : ""
    }\nWork hours: ${request.preferences?.workdayStartHour ?? 9}:00-${request.preferences?.workdayEndHour ?? 18}:00\n\nCurrent schedule:\n${scheduleList || "(empty)"}\n\nReturn JSON.`;

    const raw = await this.callBridge("timeslots", "default", userMessage);
    const parsed = this.parseJSON<{ slots?: TimeslotOption[]; reasoning?: string }>(raw);

    return {
      slots: parsed.slots ?? [],
      reasoning: parsed.reasoning,
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // General Chat
  // ──────────────────────────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const raw = await this.callBridge("chat", "default", lastUserMsg);

    if (request.jsonMode) {
      const parsed = this.parseJSON<unknown>(raw);
      return { content: raw, parsed, source: this.type };
    }

    return { content: raw, source: this.type };
  }
}

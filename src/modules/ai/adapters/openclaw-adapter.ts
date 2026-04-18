/**
 * OpenClaw Adapter — Agentic AI via OpenClaw Gateway.
 *
 * This adapter connects to OpenClaw Gateway via WebSocket and uses
 * agentic sessions with tool-calling capabilities. The OpenClaw agent
 * can fetch schedule context, inspect tasks, and generate richer
 * suggestions than a raw LLM.
 *
 * Key advantages over LLM adapter:
 *   - Tool calling: agent can query schedule data in real-time
 *   - Persistent sessions: accumulates context across requests
 *   - Code execution: can run analysis scripts
 *   - Multi-step reasoning with intermediate tool calls
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
import {
  OpenClawGatewayClient,
  type OpenClawRuntimeClient,
} from "../../runtime/openclaw/client";
import { loadOpenClawPersistedDeviceIdentity } from "../../runtime/openclaw/device-identity";

// ────────────────────────────────────────────────────────────────────
// OpenClaw-specific config
// ────────────────────────────────────────────────────────────────────

export interface OpenClawAdapterOptions {
  gatewayUrl?: string;
  authToken?: string;
  authPassword?: string;
  identityDir?: string;
  /** Timeout for agent responses in ms (default: 30000) */
  timeoutMs?: number;
}

// ────────────────────────────────────────────────────────────────────
// Session naming
// ────────────────────────────────────────────────────────────────────

type SessionPurpose =
  | "suggest"
  | "decompose"
  | "conflicts"
  | "timeslots"
  | "chat";

function buildSessionKey(
  purpose: SessionPurpose,
  workspaceId: string,
): string {
  return `ai-adapter::${purpose}::${workspaceId}`;
}

// ────────────────────────────────────────────────────────────────────
// System Prompts
// ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<SessionPurpose, string> = {
  suggest: `You are a smart scheduling assistant embedded in a task planning application.
When given a partial task title and context, generate 2-4 task suggestions.

You have access to tools:
- schedule.list_tasks: lists existing tasks
- schedule.get_health: schedule health metrics
- schedule.check_conflicts: check time window conflicts

Rules:
1. Return valid JSON with "suggestions" array
2. Each: { title, description, priority (Low/Medium/High/Urgent), estimatedMinutes, tags[], suggestedSlot?: { startAt, endAt } }
3. Use tools only when genuinely helpful (avoid duplicates, assess load)
4. Respond in the same language as input
5. No markdown wrapping — raw JSON only`,

  decompose: `You are a task decomposition assistant for a scheduling application.
Break tasks into 2-8 actionable subtasks.

You have access to tools to query existing tasks and dependencies.

Return JSON:
{
  "subtasks": [{ "title", "description", "estimatedMinutes", "priority", "order", "dependsOn": [] }],
  "reasoning": "why this decomposition"
}

Rules:
- Subtasks must be specific and actionable
- Estimate realistic durations
- Mark dependencies by order number
- Respond in the same language as input`,

  conflicts: `You are a schedule conflict analyzer for a task planning application.
Analyze task schedules to find conflicts and suggest resolutions.

You have access to tools to query the full schedule and task details.

Return JSON:
{
  "conflicts": [{ "id", "type" (time_overlap|overload|fragmentation|dependency), "severity" (low|medium|high), "taskIds": [], "description", "timeRange"?: { "start", "end" } }],
  "resolutions": [{ "conflictId", "type" (reschedule|split|merge|defer|reorder), "description", "reason", "changes": [{ "taskId", "scheduledStartAt"?, "scheduledEndAt"?, "priority"? }] }],
  "summary": "overall assessment"
}`,

  timeslots: `You are a scheduling optimizer for a task planning application.
Given a task and current schedule, suggest optimal time slots.

You have access to tools to query the full schedule.

Return JSON:
{
  "slots": [{ "startAt": "ISO", "endAt": "ISO", "score": 0.0-1.0, "reason" }],
  "reasoning": "overall logic"
}

Rules:
- Suggest 2-5 slots, sorted by score
- Avoid conflicts
- Consider work hours and buffer time`,

  chat: `You are a helpful scheduling assistant with access to the user's task and schedule data.
Answer questions about scheduling, help organize tasks, and provide planning advice.
When the user asks about their schedule, use your tools to fetch current data.
Respond in the same language as the user.`,
};

// ────────────────────────────────────────────────────────────────────
// Adapter Implementation
// ────────────────────────────────────────────────────────────────────

export class OpenClawAdapter extends AIAdapter {
  private client: OpenClawRuntimeClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private initializedSessions = new Set<string>();
  private options: OpenClawAdapterOptions;

  constructor(config: AIAdapterConfig) {
    super(config);
    this.options = (config.options ?? {}) as OpenClawAdapterOptions;
  }

  get type(): string {
    return "openclaw";
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
    const gatewayUrl = this.resolveGatewayUrl();
    const auth = this.resolveAuth();
    return Boolean(gatewayUrl) && Boolean(auth);
  }

  // ──────────────────────────────────────────────────────────────────
  // Connection Management
  // ──────────────────────────────────────────────────────────────────

  private resolveGatewayUrl(): string {
    return (
      this.options.gatewayUrl ??
      process.env.OPENCLAW_GATEWAY_URL ??
      process.env.OPENCLAW_BASE_URL ??
      ""
    );
  }

  private resolveAuth(): Record<string, string> | null {
    if (this.options.authToken) {
      return { token: this.options.authToken };
    }
    const token =
      process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY;
    if (token) return { token };

    const password =
      this.options.authPassword ?? process.env.OPENCLAW_AUTH_PASSWORD;
    if (password) return { password };

    return null;
  }

  private async getClient(): Promise<OpenClawRuntimeClient> {
    if (this.client) return this.client;

    const deviceIdentity = await loadOpenClawPersistedDeviceIdentity({
      identityDir: this.options.identityDir ?? process.env.OPENCLAW_IDENTITY_DIR,
    });

    const auth = deviceIdentity?.deviceToken
      ? { deviceToken: deviceIdentity.deviceToken }
      : (this.resolveAuth() as Record<string, string>) ?? {};

    const client = new OpenClawGatewayClient({
      gatewayUrl: this.resolveGatewayUrl(),
      auth,
      deviceIdentity,
      client: {
        id: `agentdashboard-ai-${this.config.id}`,
        version: "0.1.0",
        platform: process.platform,
        mode: "probe" as const,
      },
    });

    this.client = client;
    return client;
  }

  private async ensureConnected(): Promise<OpenClawRuntimeClient> {
    const client = await this.getClient();
    if (!this.connectPromise) {
      this.connectPromise = client
        .connect()
        .then(() => {})
        .catch((err) => {
          this.client = null;
          this.connectPromise = null;
          throw err;
        });
    }
    await this.connectPromise;
    return client;
  }

  // ──────────────────────────────────────────────────────────────────
  // Core request pattern: send prompt, wait, extract response
  // ──────────────────────────────────────────────────────────────────

  private async sendAndWait(
    purpose: SessionPurpose,
    workspaceId: string,
    userMessage: string,
  ): Promise<string> {
    const sessionKey = buildSessionKey(purpose, workspaceId);
    const timeoutMs = this.options.timeoutMs ?? 30_000;

    let client: OpenClawRuntimeClient;
    try {
      client = await this.ensureConnected();
    } catch (err) {
      throw new AIAdapterError(
        `Failed to connect to OpenClaw Gateway: ${err}`,
        this.type,
        "unavailable",
        err,
      );
    }

    // Prepend system prompt on first use of this session
    const isFirst = !this.initializedSessions.has(sessionKey);
    const prompt = isFirst
      ? `${SYSTEM_PROMPTS[purpose]}\n\n---\n\n${userMessage}`
      : userMessage;

    const runResult = await client.createRun({
      prompt,
      runtimeSessionKey: sessionKey,
    });

    this.initializedSessions.add(sessionKey);

    if (!runResult.runtimeRunRef) {
      throw new AIAdapterError(
        "OpenClaw did not return a run reference",
        this.type,
        "invalid_response",
      );
    }

    // Wait for completion
    await client.waitForRun({
      runtimeRunRef: runResult.runtimeRunRef,
      runtimeSessionKey: sessionKey,
      timeoutMs,
    });

    // Read the latest assistant message
    const history = await client.readOutputs(sessionKey);
    return this.extractLastAssistantMessage(history.messages);
  }

  private extractLastAssistantMessage(
    messages: Array<Record<string, unknown>>,
  ): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const role = msg.role ?? msg.stream ?? msg.type;
      if (role !== "assistant" && role !== "agent") continue;

      const content =
        typeof msg.content === "string"
          ? msg.content
          : typeof msg.message === "string"
            ? msg.message
            : typeof msg.text === "string"
              ? msg.text
              : null;

      if (content) return content;
    }
    return "";
  }

  private parseJSON<T>(raw: string): T {
    // Try direct parse, then extract from markdown code block
    const jsonMatch =
      raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ??
      raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch?.[1] ?? raw;

    try {
      return JSON.parse(jsonStr.trim()) as T;
    } catch {
      throw new AIAdapterError(
        `Failed to parse JSON from OpenClaw response: ${raw.slice(0, 200)}`,
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
    const workspaceId = request.workspaceId ?? "ws_default";

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
      contextParts.length
        ? `\n\nContext:\n${contextParts.join("\n")}`
        : ""
    }\n\nReturn JSON: { "suggestions": [...] }`;

    const raw = await this.sendAndWait("suggest", workspaceId, userMessage);
    const parsed = this.parseJSON<{
      suggestions?: Array<Partial<SmartSuggestion>>;
    }>(raw);

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

  async decompose(
    request: DecomposeTaskRequest,
  ): Promise<DecomposeTaskResponse> {
    const userMessage = `Decompose this task:\nTitle: "${request.title}"${
      request.description ? `\nDescription: ${request.description}` : ""
    }${
      request.estimatedMinutes
        ? `\nEstimated: ${request.estimatedMinutes} minutes`
        : ""
    }\n\nReturn JSON: { "subtasks": [...], "reasoning": "..." }`;

    const raw = await this.sendAndWait(
      "decompose",
      "ws_default",
      userMessage,
    );
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

  async analyzeConflicts(
    request: AnalyzeConflictsRequest,
  ): Promise<AnalyzeConflictsResponse> {
    const taskList = request.tasks
      .map(
        (t) =>
          `- ${t.id}: "${t.title}" ${t.scheduledStartAt ?? "?"}~${t.scheduledEndAt ?? "?"} ${t.priority ?? "Medium"}`,
      )
      .join("\n");

    const userMessage = `Analyze conflicts in this schedule:\n${taskList}${
      request.focusDate ? `\n\nFocus date: ${request.focusDate}` : ""
    }\n\nYou can also use tools to get additional context. Return JSON.`;

    const raw = await this.sendAndWait(
      "conflicts",
      request.workspaceId ?? "ws_default",
      userMessage,
    );
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

  async suggestTimeslots(
    request: SuggestTimeslotRequest,
  ): Promise<SuggestTimeslotResponse> {
    const scheduleList = request.currentSchedule
      .filter((t) => t.scheduledStartAt)
      .map((t) => `- "${t.title}" ${t.scheduledStartAt}~${t.scheduledEndAt}`)
      .join("\n");

    const userMessage = `Find optimal time slots for:\nTask: "${request.taskTitle}" (${request.estimatedMinutes} min, ${request.priority ?? "Medium"})${
      request.deadline ? `\nDeadline: ${request.deadline}` : ""
    }\nWork hours: ${request.preferences?.workdayStartHour ?? 9}:00-${request.preferences?.workdayEndHour ?? 18}:00\nBuffer: ${request.preferences?.bufferMinutes ?? 15} min\n\nCurrent schedule:\n${scheduleList || "(empty)"}\n\nYou can also use tools to check for conflicts. Return JSON.`;

    const raw = await this.sendAndWait(
      "timeslots",
      "ws_default",
      userMessage,
    );
    const parsed = this.parseJSON<{
      slots?: TimeslotOption[];
      reasoning?: string;
    }>(raw);

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
    const lastUserMsg =
      [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const raw = await this.sendAndWait("chat", "ws_default", lastUserMsg);

    if (request.jsonMode) {
      const parsed = this.parseJSON<unknown>(raw);
      return {
        content: raw,
        parsed,
        source: this.type,
      };
    }

    return {
      content: raw,
      source: this.type,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.client) {
      try {
        (this.client as OpenClawGatewayClient).close?.();
      } catch {
        // Best effort
      }
      this.client = null;
      this.connectPromise = null;
      this.initializedSessions.clear();
    }
  }
}

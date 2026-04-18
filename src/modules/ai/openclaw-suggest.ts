/**
 * OpenClaw-backed smart suggest service.
 *
 * Instead of calling a plain LLM endpoint, this module creates a dedicated
 * OpenClaw Gateway session for the "suggest" use case.  The agent running
 * inside OpenClaw has access to custom tools (registered as an OpenClaw
 * plugin) that can call back into our schedule backend to fetch context
 * (existing tasks, conflicts, schedule health) before generating
 * suggestions.
 *
 * Architecture:
 *
 *   Browser ──> /api/ai/auto-complete
 *                │
 *                ▼
 *         OpenClawSuggestService
 *                │
 *                ├── connect()  (reuse persistent WS)
 *                ├── ensureSuggestSession()  (session per workspace)
 *                ├── agent message: "suggest for: <title>"
 *                │       │
 *                │       ▼  OpenClaw agent may call tools:
 *                │       ├── schedule.list_tasks  → our API
 *                │       ├── schedule.get_health  → our API
 *                │       └── schedule.check_conflicts → our API
 *                │       │
 *                │       ▼  Agent returns structured JSON suggestions
 *                └── parse response → AutoCompleteSuggestion[]
 *
 * Key design decisions:
 *   - Session key = `suggest::<workspaceId>` — one per workspace, reused
 *     across requests so the agent accumulates context about the user's
 *     schedule patterns.
 *   - The request includes a `requestId` (UUID) so that we can correlate
 *     the response even if multiple requests are in flight.
 *   - Tools are defined in the OpenClaw plugin (see schedule-suggest-plugin/)
 *     and wrap our existing API endpoints.  The plugin controls which
 *     parameters to pass — the AI never fabricates request_id or task_id
 *     on its own.
 *   - Falls back to the existing rule-based engine if OpenClaw is unavailable.
 */

import { randomUUID } from "node:crypto";
import {
  OpenClawGatewayClient,
  type OpenClawRuntimeClient,
} from "@/modules/runtime/openclaw/client";
import { loadOpenClawPersistedDeviceIdentity } from "@/modules/runtime/openclaw/device-identity";

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface AutoCompleteSuggestion {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  estimatedMinutes: number;
  tags: string[];
}

export interface SuggestInput {
  /** The partial title the user is typing. */
  title: string;
  /** Workspace scope for context. */
  workspaceId?: string;
  /** Optional extra context (e.g. selected day, current view). */
  context?: {
    selectedDay?: string;
    existingTaskCount?: number;
    scheduledMinutesToday?: number;
  };
}

export interface SuggestResult {
  suggestions: AutoCompleteSuggestion[];
  source: "openclaw" | "fallback";
  requestId: string;
}

// ────────────────────────────────────────────────────────────────────────
// System prompt for the suggest agent inside OpenClaw
// ────────────────────────────────────────────────────────────────────────

function buildSuggestSystemPrompt(): string {
  return `You are a smart scheduling assistant embedded inside a task planning application.

Your job: when the user starts typing a task title, generate 2-3 task suggestions that complete and enrich what they are typing.

You have access to tools that let you query the user's current schedule:
- schedule.list_tasks: lists existing tasks in the workspace
- schedule.get_health: returns schedule health metrics (load, conflicts, idle windows)
- schedule.check_conflicts: checks if a proposed time window conflicts with existing tasks

Rules:
1. Always return valid JSON with a "suggestions" array.
2. Each suggestion has: title, description, priority (Low/Medium/High/Urgent), estimatedMinutes, tags (string array).
3. Use tools only when they would genuinely improve suggestions (e.g. to avoid duplicates, to suggest appropriate priority based on current load).
4. Do NOT call tools for every request — simple title completions don't need schedule context.
5. Keep suggestions concise and actionable.
6. If the title is in Chinese, respond with Chinese suggestions. If in English, respond in English.
7. The user's partial title is the PRIMARY input. Suggestions should feel like natural completions.

Response format (strict JSON, no markdown wrapping):
{"suggestions":[{"title":"Full task title","description":"Brief description","priority":"Medium","estimatedMinutes":30,"tags":["tag1"]}]}`;
}

// ────────────────────────────────────────────────────────────────────────
// Singleton client management
// ────────────────────────────────────────────────────────────────────────

let cachedClient: OpenClawRuntimeClient | null = null;
let cachedConnectPromise: Promise<void> | null = null;

/** Track which session keys have been initialized with system prompt. */
const initializedSessions = new Set<string>();

export function isOpenClawSuggestAvailable(): boolean {
  return (
    process.env.OPENCLAW_MODE !== "mock" &&
    Boolean(
      process.env.OPENCLAW_GATEWAY_URL ?? process.env.OPENCLAW_BASE_URL,
    ) &&
    Boolean(
      process.env.OPENCLAW_AUTH_TOKEN ??
        process.env.OPENCLAW_API_KEY ??
        process.env.OPENCLAW_AUTH_PASSWORD,
    )
  );
}

async function getOrCreateClient(): Promise<OpenClawRuntimeClient> {
  if (cachedClient) {
    return cachedClient;
  }

  const deviceIdentity = await loadOpenClawPersistedDeviceIdentity({
    identityDir: process.env.OPENCLAW_IDENTITY_DIR,
  });

  const auth = deviceIdentity?.deviceToken
    ? { deviceToken: deviceIdentity.deviceToken }
    : process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY
      ? {
          token: (process.env.OPENCLAW_AUTH_TOKEN ??
            process.env.OPENCLAW_API_KEY)!,
        }
      : process.env.OPENCLAW_AUTH_PASSWORD
        ? { password: process.env.OPENCLAW_AUTH_PASSWORD }
        : {};

  const client = new OpenClawGatewayClient({
    gatewayUrl:
      process.env.OPENCLAW_GATEWAY_URL ??
      process.env.OPENCLAW_BASE_URL ??
      "",
    auth,
    deviceIdentity,
    client: {
      id: "agentdashboard-suggest",
      version: "0.1.0",
      platform: process.platform,
      mode: "probe" as const,
    },
  });

  cachedClient = client;
  return client;
}

async function ensureConnected(): Promise<OpenClawRuntimeClient> {
  const client = await getOrCreateClient();

  if (!cachedConnectPromise) {
    cachedConnectPromise = client
      .connect()
      .then(() => {})
      .catch((err) => {
        cachedClient = null;
        cachedConnectPromise = null;
        throw err;
      });
  }

  await cachedConnectPromise;
  return client;
}

// ────────────────────────────────────────────────────────────────────────
// Session management — one "suggest" session per workspace
// ────────────────────────────────────────────────────────────────────────

function buildSuggestSessionKey(workspaceId: string): string {
  return `suggest::${workspaceId}`;
}

// ────────────────────────────────────────────────────────────────────────
// Core suggest function
// ────────────────────────────────────────────────────────────────────────

/**
 * Generate smart task suggestions via OpenClaw Gateway.
 *
 * Flow:
 * 1. Connect to OpenClaw Gateway (reuse persistent WS).
 * 2. Create or reuse a "suggest" session for the workspace.
 * 3. Send the user's partial title as an agent message.
 * 4. OpenClaw agent may call schedule tools (handled by plugin) then
 *    returns structured JSON suggestions.
 * 5. Parse and return.
 */
export async function suggestViaOpenClaw(
  input: SuggestInput,
): Promise<SuggestResult> {
  const requestId = randomUUID();
  const workspaceId = input.workspaceId ?? "ws_default";
  const sessionKey = buildSuggestSessionKey(workspaceId);

  const client = await ensureConnected();

  // Build the user message with context
  const contextParts: string[] = [];
  if (input.context?.selectedDay) {
    contextParts.push(`Selected day: ${input.context.selectedDay}`);
  }
  if (input.context?.existingTaskCount != null) {
    contextParts.push(
      `Existing tasks: ${input.context.existingTaskCount}`,
    );
  }
  if (input.context?.scheduledMinutesToday != null) {
    contextParts.push(
      `Scheduled today: ${input.context.scheduledMinutesToday}min`,
    );
  }

  const contextStr =
    contextParts.length > 0
      ? `\n\nSchedule context:\n${contextParts.join("\n")}`
      : "";

  const userMessage = `Suggest task completions for: "${input.title}"${contextStr}

Return JSON with "suggestions" array. Each suggestion: { title, description, priority, estimatedMinutes, tags }.`;

  // For the first message in a session, prepend the system prompt
  const isFirstMessage = !initializedSessions.has(sessionKey);
  const fullMessage = isFirstMessage
    ? `${buildSuggestSystemPrompt()}\n\n---\n\n${userMessage}`
    : userMessage;

  // Send to OpenClaw via the agent method (creates session if needed)
  const runResult = await client.createRun({
    prompt: fullMessage,
    runtimeSessionKey: sessionKey,
  });

  initializedSessions.add(sessionKey);

  if (!runResult.runtimeRunRef) {
    return { suggestions: [], source: "openclaw", requestId };
  }

  // Wait for the agent to complete (short timeout for suggest)
  await client.waitForRun({
    runtimeRunRef: runResult.runtimeRunRef,
    runtimeSessionKey: sessionKey,
    timeoutMs: 15_000,
  });

  // Read the conversation to get the agent's response
  const history = await client.readOutputs(sessionKey);
  const suggestions = extractSuggestionsFromHistory(history.messages);

  return { suggestions, source: "openclaw", requestId };
}

// ────────────────────────────────────────────────────────────────────────
// Response parsing
// ────────────────────────────────────────────────────────────────────────

function extractSuggestionsFromHistory(
  messages: Array<Record<string, unknown>>,
): AutoCompleteSuggestion[] {
  // Walk messages from the end to find the latest assistant response
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

    if (!content) continue;

    const parsed = tryParseJsonSuggestions(content);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

function tryParseJsonSuggestions(text: string): AutoCompleteSuggestion[] {
  // Try to find JSON in the response (may be wrapped in markdown code block)
  const jsonMatch =
    text.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ??
    text.match(/(\{[\s\S]*"suggestions"[\s\S]*\})/);

  const jsonStr = jsonMatch?.[1] ?? text;

  try {
    const parsed = JSON.parse(jsonStr.trim());
    const suggestions = parsed.suggestions ?? parsed;

    if (!Array.isArray(suggestions)) return [];

    return suggestions
      .filter(
        (s: Record<string, unknown>) =>
          typeof s.title === "string" && s.title.length > 0,
      )
      .map((s: Record<string, unknown>) => ({
        title: s.title as string,
        description: (s.description as string) ?? "",
        priority: validatePriority(s.priority as string),
        estimatedMinutes:
          typeof s.estimatedMinutes === "number" ? s.estimatedMinutes : 30,
        tags: Array.isArray(s.tags)
          ? s.tags.filter((t): t is string => typeof t === "string")
          : [],
      }));
  } catch {
    return [];
  }
}

function validatePriority(
  p: string | undefined,
): "Low" | "Medium" | "High" | "Urgent" {
  if (p === "Low" || p === "Medium" || p === "High" || p === "Urgent") {
    return p;
  }
  return "Medium";
}

// ────────────────────────────────────────────────────────────────────────
// Reset (for testing)
// ────────────────────────────────────────────────────────────────────────

export function _resetSuggestState() {
  cachedClient = null;
  cachedConnectPromise = null;
  initializedSessions.clear();
}

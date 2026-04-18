/**
 * AI Service — Backend layer's unified entry point for all AI operations.
 *
 * This is the ONLY module the backend layer (API routes, commands) should
 * import for AI features. It handles:
 *   1. Adapter discovery and fallback
 *   2. Graceful degradation to rule-based logic
 *   3. Request validation and error normalization
 *
 * Architecture:
 *   API Route → AIService.suggest() → adapter.suggest()
 *                                      ↓ fallback
 *                                    → next adapter.suggest()
 *                                      ↓ all failed
 *                                    → rule-based fallback
 */

import { AIAdapter } from "./adapters/base";
import { LLMAdapter } from "./adapters/llm-adapter";
import {
  OpenClawAdapter,
  type OpenClawAdapterOptions,
} from "./adapters/openclaw-adapter";
import { aiAdapterRegistry } from "./adapters/registry";
import type {
  AIAdapterConfig,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  ChatRequest,
  ChatResponse,
  DecomposeTaskRequest,
  DecomposeTaskResponse,
  SmartSuggestRequest,
  SmartSuggestResponse,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
} from "./adapters/types";
import { AIAdapterError } from "./adapters/types";

// ────────────────────────────────────────────────────────────────────
// Initialization
// ────────────────────────────────────────────────────────────────────

let initialized = false;

/**
 * Initialize the AI service with available adapters.
 * Called lazily on first use. Safe to call multiple times.
 */
export function initAIService(): void {
  if (initialized) return;
  initialized = true;

  // Register factories
  aiAdapterRegistry.registerFactory("openclaw", (config) => new OpenClawAdapter(config));
  aiAdapterRegistry.registerFactory("llm", (config) => new LLMAdapter(config));

  // Auto-register adapters based on environment
  const openclawUrl =
    process.env.OPENCLAW_GATEWAY_URL ?? process.env.OPENCLAW_BASE_URL;
  const openclawAuth =
    process.env.OPENCLAW_AUTH_TOKEN ??
    process.env.OPENCLAW_API_KEY ??
    process.env.OPENCLAW_AUTH_PASSWORD;

  if (openclawUrl && openclawAuth && process.env.OPENCLAW_MODE !== "mock") {
    aiAdapterRegistry.register(
      "openclaw",
      {
        id: "openclaw-default",
        name: "OpenClaw Gateway",
        options: {
          gatewayUrl: openclawUrl,
          authToken:
            process.env.OPENCLAW_AUTH_TOKEN ?? process.env.OPENCLAW_API_KEY,
          authPassword: process.env.OPENCLAW_AUTH_PASSWORD,
          identityDir: process.env.OPENCLAW_IDENTITY_DIR,
        } satisfies OpenClawAdapterOptions,
      },
      10, // highest priority
    );
  }

  if (process.env.AI_PROVIDER_BASE_URL && process.env.AI_PROVIDER_API_KEY) {
    aiAdapterRegistry.register(
      "llm",
      {
        id: "llm-default",
        name: "LLM (OpenAI-compatible)",
        options: {},
      },
      50,
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// Adapter Resolution with Fallback
// ────────────────────────────────────────────────────────────────────

type AIOperation = "suggest" | "decompose" | "analyzeConflicts" | "suggestTimeslots" | "chat";

async function withFallback<T>(
  operation: AIOperation,
  fn: (adapter: AIAdapter) => Promise<T>,
): Promise<T | null> {
  initAIService();

  const adapters = aiAdapterRegistry.all();
  const errors: Array<{ adapter: string; error: unknown }> = [];

  for (const adapter of adapters) {
    try {
      const available = await adapter.isAvailable();
      if (!available) continue;
      return await fn(adapter);
    } catch (err) {
      errors.push({ adapter: adapter.type, error: err });
      // Continue to next adapter
    }
  }

  if (errors.length > 0) {
    console.warn(
      `[AIService] All adapters failed for ${operation}:`,
      errors.map((e) => `${e.adapter}: ${e.error}`).join("; "),
    );
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Generate smart suggestions for task creation / scheduling.
 * Returns null if no AI adapter is available.
 */
export async function aiSuggest(
  request: SmartSuggestRequest,
): Promise<SmartSuggestResponse | null> {
  return withFallback("suggest", (adapter) => adapter.suggest(request));
}

/**
 * Decompose a task into subtasks.
 * Returns null if no AI adapter is available.
 */
export async function aiDecompose(
  request: DecomposeTaskRequest,
): Promise<DecomposeTaskResponse | null> {
  return withFallback("decompose", (adapter) => adapter.decompose(request));
}

/**
 * Analyze schedule conflicts and suggest resolutions.
 * Returns null if no AI adapter is available.
 */
export async function aiAnalyzeConflicts(
  request: AnalyzeConflictsRequest,
): Promise<AnalyzeConflictsResponse | null> {
  return withFallback("analyzeConflicts", (adapter) =>
    adapter.analyzeConflicts(request),
  );
}

/**
 * Suggest optimal time slots for a task.
 * Returns null if no AI adapter is available.
 */
export async function aiSuggestTimeslots(
  request: SuggestTimeslotRequest,
): Promise<SuggestTimeslotResponse | null> {
  return withFallback("suggestTimeslots", (adapter) =>
    adapter.suggestTimeslots(request),
  );
}

/**
 * General-purpose chat completion.
 * Returns null if no AI adapter is available.
 */
export async function aiChat(
  request: ChatRequest,
): Promise<ChatResponse | null> {
  return withFallback("chat", (adapter) => adapter.chat(request));
}

/**
 * Check if any AI adapter is available.
 */
export async function isAIAvailable(): Promise<boolean> {
  initAIService();
  const best = await aiAdapterRegistry.getBestAvailable();
  return best !== null;
}

/**
 * Get info about available adapters (for diagnostics / UI).
 */
export function getAIAdapterInfo(): Array<{
  type: string;
  name: string;
  capabilities: ReturnType<AIAdapter["capabilities"]>;
}> {
  initAIService();
  return aiAdapterRegistry.all().map((a) => ({
    type: a.type,
    name: a.name,
    capabilities: a.capabilities(),
  }));
}

// ────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ────────────────────────────────────────────────────────────────────

export { AIAdapterError } from "./adapters/types";
export type {
  SmartSuggestRequest,
  SmartSuggestResponse,
  SmartSuggestion,
  DecomposeTaskRequest,
  DecomposeTaskResponse,
  AnalyzeConflictsRequest,
  AnalyzeConflictsResponse,
  SuggestTimeslotRequest,
  SuggestTimeslotResponse,
  ChatRequest,
  ChatResponse,
  AIAdapterCapabilities,
} from "./adapters/types";

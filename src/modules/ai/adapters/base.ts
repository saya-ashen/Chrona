/**
 * AIAdapter — Abstract base class for all AI adapters.
 *
 * Every AI backend (OpenClaw, raw LLM, future providers) must extend
 * this class. The backend layer creates and calls adapters through
 * this uniform interface without knowing the implementation details.
 *
 * Lifecycle:
 *   1. Factory creates adapter via AIAdapterRegistry
 *   2. Backend calls adapter methods (suggest, decompose, etc.)
 *   3. Adapter translates to provider-specific calls
 *   4. Adapter normalizes response back to unified types
 *
 * Adapters MUST:
 *   - Return capabilities() accurately
 *   - Throw AIAdapterError on failures (not raw errors)
 *   - Handle their own retries for transient failures
 *   - Be stateless per-call (sessions managed internally)
 *
 * Adapters MAY:
 *   - Override only the methods they support (defaults throw "unsupported")
 *   - Maintain internal connection pools or caches
 */

import type {
  AIAdapterCapabilities,
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
} from "./types";
import { AIAdapterError } from "./types";

export abstract class AIAdapter {
  constructor(protected readonly config: AIAdapterConfig) {}

  /** Unique identifier for this adapter type (e.g. "openclaw", "llm") */
  abstract get type(): string;

  /** Human-readable display name */
  get name(): string {
    return this.config.name;
  }

  /** What this adapter can do */
  abstract capabilities(): AIAdapterCapabilities;

  /**
   * Check if the adapter is ready to serve requests.
   * Should verify connectivity, auth, etc. without making a full request.
   */
  abstract isAvailable(): Promise<boolean>;

  // ──────────────────────────────────────────────────────────────────
  // Core AI Operations
  // ──────────────────────────────────────────────────────────────────

  /**
   * Smart suggestions — auto-complete, schedule suggestions, general advice.
   *
   * This is the primary "intelligent" feature: given a partial input and
   * context about the user's schedule, return actionable suggestions.
   *
   * For agentic adapters (OpenClaw): the agent can use tools to fetch
   * additional context before generating suggestions.
   *
   * For LLM adapters: uses prompt engineering with provided context.
   */
  async suggest(request: SmartSuggestRequest): Promise<SmartSuggestResponse> {
    throw new AIAdapterError(
      "suggest() not implemented",
      this.type,
      "internal",
    );
  }

  /**
   * Decompose a task into subtasks.
   *
   * For agentic adapters: the agent may inspect existing tasks and
   * dependencies to produce better decompositions.
   *
   * For LLM adapters: uses structured output to return subtask list.
   */
  async decompose(
    request: DecomposeTaskRequest,
  ): Promise<DecomposeTaskResponse> {
    throw new AIAdapterError(
      "decompose() not implemented",
      this.type,
      "internal",
    );
  }

  /**
   * Analyze schedule conflicts and suggest resolutions.
   */
  async analyzeConflicts(
    request: AnalyzeConflictsRequest,
  ): Promise<AnalyzeConflictsResponse> {
    throw new AIAdapterError(
      "analyzeConflicts() not implemented",
      this.type,
      "internal",
    );
  }

  /**
   * Suggest optimal time slots for a task.
   */
  async suggestTimeslots(
    request: SuggestTimeslotRequest,
  ): Promise<SuggestTimeslotResponse> {
    throw new AIAdapterError(
      "suggestTimeslots() not implemented",
      this.type,
      "internal",
    );
  }

  /**
   * General-purpose chat completion.
   * Fallback for any AI operation that doesn't have a dedicated method.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    throw new AIAdapterError(
      "chat() not implemented",
      this.type,
      "internal",
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────

  /**
   * Clean up resources (close connections, cancel pending requests).
   * Called when the adapter is being removed or the app is shutting down.
   */
  async dispose(): Promise<void> {
    // Default: no-op. Override if adapter holds resources.
  }
}

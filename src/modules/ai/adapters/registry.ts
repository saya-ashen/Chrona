/**
 * AI Adapter Registry — Factory + discovery for AI adapters.
 *
 * The backend layer uses this registry to:
 *   1. Discover available adapters
 *   2. Get the best adapter for a given operation
 *   3. Fall back through adapters if the primary is unavailable
 *
 * Priority order is configurable. By default:
 *   1. OpenClaw (agentic, tool-calling, persistent context)
 *   2. LLM (raw chat completion, structured output)
 *   3. Rule-based fallback (no AI, deterministic)
 */

import { AIAdapter } from "./base";
import type { AIAdapterCapabilities, AIAdapterConfig } from "./types";

export type AIAdapterFactory = (config: AIAdapterConfig) => AIAdapter;

interface RegisteredAdapter {
  adapter: AIAdapter;
  priority: number; // lower = preferred
}

class AIAdapterRegistry {
  private adapters = new Map<string, RegisteredAdapter>();
  private factories = new Map<string, AIAdapterFactory>();

  /**
   * Register an adapter factory for a given type.
   * Factories create adapter instances from config.
   */
  registerFactory(type: string, factory: AIAdapterFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * Create and register an adapter instance.
   * @param type Adapter type (must have a registered factory)
   * @param config Adapter configuration
   * @param priority Lower = more preferred (default: 100)
   */
  register(type: string, config: AIAdapterConfig, priority = 100): AIAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`No factory registered for adapter type: ${type}`);
    }
    const adapter = factory(config);
    this.adapters.set(config.id, { adapter, priority });
    return adapter;
  }

  /**
   * Register a pre-built adapter instance directly.
   */
  registerInstance(adapter: AIAdapter, priority = 100): void {
    this.adapters.set(adapter.name, { adapter, priority });
  }

  /**
   * Get a specific adapter by ID.
   */
  get(id: string): AIAdapter | undefined {
    return this.adapters.get(id)?.adapter;
  }

  /**
   * Get all registered adapters sorted by priority.
   */
  all(): AIAdapter[] {
    return Array.from(this.adapters.values())
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.adapter);
  }

  /**
   * Get the best available adapter, respecting priority.
   * Checks availability and returns the first that's ready.
   * Returns null if none are available.
   */
  async getBestAvailable(): Promise<AIAdapter | null> {
    const sorted = this.all();
    for (const adapter of sorted) {
      try {
        if (await adapter.isAvailable()) {
          return adapter;
        }
      } catch {
        // Skip unavailable adapters
      }
    }
    return null;
  }

  /**
   * Get the best available adapter that supports a specific capability.
   */
  async getBestFor(
    capability: keyof AIAdapterCapabilities,
  ): Promise<AIAdapter | null> {
    const sorted = this.all();
    for (const adapter of sorted) {
      try {
        if (adapter.capabilities()[capability] && (await adapter.isAvailable())) {
          return adapter;
        }
      } catch {
        // Skip
      }
    }
    return null;
  }

  /**
   * Remove an adapter and dispose its resources.
   */
  async remove(id: string): Promise<void> {
    const registered = this.adapters.get(id);
    if (registered) {
      await registered.adapter.dispose();
      this.adapters.delete(id);
    }
  }

  /**
   * Dispose all adapters.
   */
  async disposeAll(): Promise<void> {
    for (const { adapter } of Array.from(this.adapters.values())) {
      try {
        await adapter.dispose();
      } catch {
        // Best effort
      }
    }
    this.adapters.clear();
  }
}

// Singleton registry
export const aiAdapterRegistry = new AIAdapterRegistry();

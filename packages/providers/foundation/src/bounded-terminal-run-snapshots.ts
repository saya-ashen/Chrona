import type { ProviderRunSnapshot } from "./contracts/provider";

const DEFAULT_MAXIMUM_TERMINAL_SNAPSHOTS = 128;
const DEFAULT_TERMINAL_SNAPSHOT_TTL_MS = 5 * 60_000;

type Entry = {
  snapshot: ProviderRunSnapshot;
  expiresAt: number;
};

/**
 * Bounded, immutable terminal-run cache. Live handles deliberately do not
 * belong here: callers may look up only a recently finalized snapshot.
 */
export class BoundedTerminalRunSnapshots {
  private readonly entries = new Map<string, Entry>();
  private readonly maximum: number;
  private readonly ttlMs: number;

  constructor(options: { maximum?: number; ttlMs?: number } = {}) {
    this.maximum = Math.max(1, options.maximum ?? DEFAULT_MAXIMUM_TERMINAL_SNAPSHOTS);
    this.ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TERMINAL_SNAPSHOT_TTL_MS);
  }

  get(runId: string): ProviderRunSnapshot | undefined {
    this.prune();
    const entry = this.entries.get(runId);
    if (!entry) return undefined;
    // Refresh insertion order for LRU eviction without extending the TTL.
    this.entries.delete(runId);
    this.entries.set(runId, entry);
    return structuredClone(entry.snapshot);
  }

  set(snapshot: ProviderRunSnapshot): void {
    this.prune();
    this.entries.delete(snapshot.runId);
    this.entries.set(snapshot.runId, {
      snapshot: structuredClone(snapshot),
      expiresAt: Date.now() + this.ttlMs,
    });
    while (this.entries.size > this.maximum) {
      const oldestRunId = this.entries.keys().next().value;
      if (oldestRunId === undefined) return;
      this.entries.delete(oldestRunId);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const current = Date.now();
    for (const [runId, entry] of this.entries) {
      if (entry.expiresAt <= current) this.entries.delete(runId);
    }
  }
}

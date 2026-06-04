import type { GraphExecutionEvent } from "@chrona/graph-runtime";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import type { EffectivePlanGraph } from "@chrona/contracts/ai";

export type EngineRuntimeContext = {
  taskId: string;
  workBlockId?: string | null;
  planId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
  control?: { signal?: AbortSignal; shouldPause?: () => boolean };
};

export type PlanExecutionRuntimeEvent = {
  nodeId: string;
  nodeTitle: string;
  runtimeName: string;
  event: ProviderRunEvent;
};

export type PlanExecutionObserver = {
  onGraphEvent?: (event: GraphExecutionEvent) => Promise<void> | void;
  onRuntimeEvent?: (event: PlanExecutionRuntimeEvent) => Promise<void> | void;
  onStateChange?: (effectivePlan: EffectivePlanGraph) => Promise<void> | void;
};

/**
 * Raised when an epoch-guarded write loses to a concurrent command. The single
 * writer rejects the stale command rather than corrupting state; callers may
 * reload and re-issue.
 */
export class ExecutionConflictError extends Error {
  constructor(message = "Execution state changed concurrently") {
    super(message);
    this.name = "ExecutionConflictError";
  }
}

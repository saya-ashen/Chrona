import type { GraphExecutionEvent } from "@chrona/graph-runtime";
import type { ProviderRunEvent } from "@chrona/providers-foundation";
import type { EffectivePlanGraph } from "@chrona/contracts/ai";

import type { CompiledPlan } from "@chrona/contracts/ai";
import type { PersistedPlanRun } from "../persistence/plan-runtime-store";
import type { NodeExecutionRunContext } from "../node-executors/types";

export type EngineRuntimeContext = {
  taskId: string;
  workBlockId?: string | null;
  planId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
  control?: { signal?: AbortSignal; shouldPause?: () => boolean };
};

export type KernelCallbacksInput = {
  taskId: string;
  sessionId: string;
  runtimeName: string;
  mainSession: EngineRuntimeContext["mainSession"];
  workspaceId: string;
  workBlockId: string | null;
  planId: string;
  compiledPlan: CompiledPlan;
  executionEpoch: number;
  persisted: PersistedPlanRun;
  planSummary?: string | null;
  taskContext: { title: string; description?: string };
  goalContext?: import("../node-executors/types").NodeExecutionPlanContext["goalContext"];
  initialRunContext?: NodeExecutionRunContext;
  updateSessionProjection?: boolean;
};

export type PlanExecutionRuntimeEvent = {
  nodeId: string;
  executionScope: string;
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

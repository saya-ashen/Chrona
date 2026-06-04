// Domain graph types are owned by @chrona/contracts/ai. graph-runtime re-exports
// them so engine <-> runtime share one type system (no `as unknown as` bridging).
export type {
  TaskPriority,
  TaskConfig,
  CheckpointConfig,
  ConditionConfig,
  WaitConfig,
  NodeConfig,
  WaitKind,
  NodeDefinition,
  NodeDefinitionLayer,
  NodeInvalidationLayer,
  NodeCancellationLayer,
  NodeLayer,
  NodeLayerType,
  LayerSource,
  PlanNode,
  PlanEdge,
  PlanEdgeType,
  PlanGraph,
  PlanGraphStatus,
  GraphMutation,
  GraphMutationOperation,
  CompiledNode,
  CompiledEdge,
  EffectivePlanNode,
  EffectivePlanEdge,
  EffectivePlanGraph,
  ResolveEffectivePlanGraphInput,
  TaskExecutor,
  TaskMode,
} from "@chrona/contracts/ai";

import type {
  PlanEdgeType,
  NodeLayer,
  NodeLayerType,
  TaskMode,
  CompiledNode,
  CompiledEdge,
} from "@chrona/contracts/ai";

// ─── graph-runtime-local refinements (not part of the shared contract) ───

export type PlanNodeType = "task" | "checkpoint" | "condition" | "wait";

/** Alias kept for graph-runtime call sites; identical to contracts TaskMode. */
export type TaskExecutionMode = TaskMode;

export type DependencyEdgeType = "hard_dependency" | "ordering";
export type ContextEdgeType = "context";
export type GateEdgeType = "review_gate";
export type BranchEdgeType = "branch";

/** Union over the shared PlanEdgeType, kept under the runtime-local name. */
export type EdgeType = PlanEdgeType;

export type PlanNodeLayerType = NodeLayerType;

/** Alias kept for graph-runtime call sites; identical to contracts NodeLayer. */
export type PlanNodeLayer = NodeLayer;

/**
 * Reduced CompiledPlan accepted by the graph builder. The contracts CompiledPlan
 * is a superset (adds title/goal/topology metadata) and remains assignable here.
 */
export interface CompiledPlan {
  id: string;
  editablePlanId: string;
  sourceVersion: number;
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  entryNodeIds: string[];
}

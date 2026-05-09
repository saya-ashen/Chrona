import type { EdgeType, EffectivePlanGraph, GraphMutationOperation, PlanEdge, PlanGraph } from "./graph";
import type { NodeRuntimeStatus } from "./runtime";

export type DependencyTraversalDirection = "upstream" | "downstream";

export interface DependencyTraversalOptions {
  direction: DependencyTraversalDirection;
  edgeTypes?: EdgeType[];
  includeInactiveEdges?: boolean;
  maxDepth?: number;
}

export interface DependencyTraversalResult {
  startNodeIds: string[];
  visitedNodeIds: string[];
  traversedEdgeIds: string[];
}

export interface StructuralChangeImpactInput {
  graph: PlanGraph;
  operations: GraphMutationOperation[];
  edgeTypes?: EdgeType[];
}

export interface StructuralChangeImpact {
  affectedNodeIds: string[];
  invalidatedNodeIds: string[];
  addedNodeIds: string[];
  removedNodeIds: string[];
  changedEdgeIds: string[];
}

export interface DownstreamInvalidationInput {
  graph: PlanGraph;
  changedNodeIds: string[];
  edgeTypes?: EdgeType[];
  reason: string;
}

export interface DownstreamInvalidationPlan {
  rootNodeIds: string[];
  invalidatedNodeIds: string[];
  reason: string;
}

export interface ReadyNodeSelectionOptions {
  includeManualNodes?: boolean;
  includeWaitingNodes?: boolean;
  maxNodes?: number;
}

export interface ReadyNodeSelection {
  graph: EffectivePlanGraph;
  selectedNodeIds: string[];
  blockedNodeIds: string[];
}

export interface NodeStatusTransitionInput {
  nodeId: string;
  from: NodeRuntimeStatus;
  to: NodeRuntimeStatus;
  reason?: string;
}

export interface EdgeSemantics {
  type: EdgeType;
  blocksReadiness: boolean;
  propagatesInvalidation: boolean;
  contributesContext: boolean;
  selectsBranch: boolean;
}

export interface EdgeSemanticsResolution {
  edge: PlanEdge;
  semantics: EdgeSemantics;
}

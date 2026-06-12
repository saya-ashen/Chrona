// graph.ts owns graph-mutation and layer types. The heavy compiled/
// effective shapes (CompiledNode, CompiledEdge, CompiledPlan,
// EffectivePlanNode, EffectivePlanEdge, EffectivePlanGraph,
// PlanGraphStatus, NodeRuntimeState, NodeRuntimeStatus) live in
// ./_leaf so they can be referenced by execution-state.ts without
// forming a back-edge import. They are re-exported here so external
// consumers (which import these names from @chrona/contracts/ai)
// keep working.

import type { TaskExecutor, TaskMode } from "../ai-plan-blueprint";
import type { NodeAttempt } from "./attempts";
import type { NodeResult } from "./node-result";
import type {
  NodeConfig,
  NodeDefinition,
} from "./node";
import type {
  CompiledNode,
  CompiledEdge,
  CompiledPlan,
  EffectivePlanNode,
  EffectivePlanEdge,
  EffectivePlanGraph,
  PlanGraphStatus,
} from "./_leaf";
import type { NodeRuntimeState } from "./execution-state";

export type {
  CompiledNode,
  CompiledEdge,
  CompiledPlan,
  EffectivePlanNode,
  EffectivePlanEdge,
  EffectivePlanGraph,
  PlanGraphStatus,
} from "./_leaf";

// ═══════════════════════════════════════════════════════════════
// Layered Mutable Plan Graph
// ═══════════════════════════════════════════════════════════════

export type PlanEdgeType =
  | "hard_dependency"
  | "ordering"
  | "context"
  | "review_gate"
  | "branch";

export interface NodeDefinitionLayer {
  id: string;
  nodeId: string;
  type: "definition";
  createdAt: string;
  createdBy: LayerSource;
  reason?: string;
  definition: NodeDefinition;
}

export interface NodeInvalidationLayer {
  id: string;
  nodeId: string;
  type: "invalidation";
  createdAt: string;
  createdBy: LayerSource;
  reason: string;
  invalidatedByNodeId?: string;
  invalidatedByMutationId?: string;
}

export interface NodeCancellationLayer {
  id: string;
  nodeId: string;
  type: "cancellation";
  createdAt: string;
  createdBy: LayerSource;
  reason: string;
  cancelledAttemptId?: string;
}

export type NodeLayer =
  | NodeDefinitionLayer
  | NodeInvalidationLayer
  | NodeCancellationLayer;

export interface PlanNode {
  id: string;
  semanticKey: string;
  layers: NodeLayer[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: PlanEdgeType;
  active: boolean;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export type GraphMutationOperation =
  | {
      type: "add_node";
      nodeId: string;
      semanticKey: string;
      definitionLayer: NodeDefinitionLayer;
    }
  | {
      type: "push_node_layer";
      nodeId: string;
      layer: NodeLayer;
    }
  | {
      type: "add_edge";
      edge: PlanEdge;
    }
  | {
      type: "remove_edge";
      edgeId: string;
    }
  | {
      type: "update_edge";
      edgeId: string;
      patch: Partial<Pick<PlanEdge, "active" | "label" | "type">>;
    }
  | {
      type: "delete_node";
      nodeId: string;
    }
  | {
      type: "replace_subgraph";
      removeNodeIds: string[];
      nodes: Array<{
        nodeId: string;
        semanticKey: string;
        definitionLayer: NodeDefinitionLayer;
      }>;
      edges: PlanEdge[];
    };

export interface GraphMutation {
  id: string;
  graphId: string;
  createdAt: string;
  createdBy: LayerSource;
  reason: string;
  operations: GraphMutationOperation[];
  affectedNodeIds: string[];
  invalidatedNodeIds: string[];
}

export interface PlanGraph {
  id: string;
  taskId: string;
  status: PlanGraphStatus;
  nodes: PlanNode[];
  edges: PlanEdge[];
  mutations: GraphMutation[];
  createdAt: string;
  updatedAt: string;
}

export type LayerSource = "user" | "ai" | "system";

// ─── Structural Layer ───

export type StructuralOperation =
  | { op: "add_node"; nodeId: string; localId: string; type: "task" | "checkpoint" | "condition" | "wait"; title: string; config: NodeConfig; executor?: TaskExecutor; mode?: TaskMode; estimatedMinutes?: number }
  | { op: "update_node"; nodeId: string; patch: Partial<Pick<CompiledNode, "title" | "type" | "config" | "executor" | "mode" | "estimatedMinutes">> }
  | { op: "delete_node"; nodeId: string }
  | { op: "add_edge"; from: string; to: string; label?: string }
  | { op: "delete_edge"; from: string; to: string }
  | { op: "replace_subgraph"; removeNodeIds: string[]; addNodes: Array<{ nodeId: string; localId: string; type: "task" | "checkpoint" | "condition" | "wait"; title: string; config: NodeConfig; executor?: TaskExecutor; mode?: TaskMode; estimatedMinutes?: number }>; addEdges: Array<{ from: string; to: string; label?: string }> };

export interface StructuralLayer {
  layerId: string;
  planId: string;
  type: "structural";
  version: number;
  source: LayerSource;
  active: boolean;
  timestamp: string;
  rationale?: string;
  operations: StructuralOperation[];
}

// ─── Runtime Layer (execution status) ───

export interface RuntimeLayer {
  layerId: string;
  planId: string;
  type: "runtime";
  version: number;
  active: boolean;
  timestamp: string;
  source?: LayerSource;
  /** nodeId → status update. Only changed nodes need entries. Each entry must include 'status'; other fields are optional. */
  nodeStates: Record<string, Pick<NodeRuntimeState, "status"> & Partial<Pick<NodeRuntimeState, "attempts" | "linkedTaskId" | "lastError" | "startedAt" | "completedAt">>>;
}

export interface ResultLayer {
  layerId: string;
  planId: string;
  type: "result";
  version: number;
  active: boolean;
  timestamp: string;
  source?: LayerSource;
  /** nodeId → result. Only nodes that produced results need entries. */
  nodeResults: Record<string, NodeResult>;
}

export type PlanOverlayLayer = StructuralLayer | RuntimeLayer | ResultLayer;

export interface ResolveEffectivePlanGraphInput {
  graph: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
}

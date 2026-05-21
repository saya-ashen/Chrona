import type {
  CompiledPlanCompletionPolicy,
  TaskExecutor,
  TaskMode,
  ValidationWarning,
} from "../ai-plan-blueprint";
import type { NodeAttempt } from "./attempts";
import type { NodeRuntimeState, NodeRuntimeStatus } from "./execution-state";
import type { NodeResult } from "./node-result";
import type {
  NodeConfig,
  NodeDefinition,
  TaskPriority,
  WaitKind,
} from "./node";

export interface CompiledNode {
  id: string;
  localId: string;
  type: "task" | "checkpoint" | "condition" | "wait";
  title: string;
  description?: string;
  priority?: TaskPriority;
  linkedTaskId?: string;
  config: NodeConfig;
  dependencies: string[];
  dependents: string[];
  executor?: TaskExecutor;
  mode?: TaskMode;
  estimatedMinutes?: number;
}

export interface CompiledEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface CompiledPlan {
  id: string;
  editablePlanId: string;
  sourceVersion: number;
  title: string;
  goal: string;
  assumptions: string[];
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
  topologicalOrder: string[];
  completionPolicy: CompiledPlanCompletionPolicy;
  validationWarnings: ValidationWarning[];
}

// ═══════════════════════════════════════════════════════════════
// Layered Mutable Plan Graph
// ═══════════════════════════════════════════════════════════════

export type PlanGraphStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "superseded"
  | "archived";

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

// ─── Effective Plan Graph (resolved view) ───

export interface EffectivePlanNode {
  /** Stable plan node ID. Preserved as `id` for existing UI consumers. */
  id: string;
  nodeId: string;
  activeLayerId: string | null;
  semanticKey: string;
  definition: NodeDefinition;
  invalidated: boolean;
  invalidationReason?: string;
  waitKind?: WaitKind;
  reviewRequired?: boolean;
  /** Original editable plan node ID */
  localId: string;
  type: "task" | "checkpoint" | "condition" | "wait";
  title: string;
  description?: string;
  priority?: TaskPriority;
  linkedTaskId?: string;
  config: NodeConfig;
  executor?: TaskExecutor;
  mode?: TaskMode;
  estimatedMinutes?: number;
  /** Compiled node IDs this node depends on */
  dependencies: string[];
  /** Compiled node IDs that depend on this node */
  dependents: string[];
  /** Merged from latest active RuntimeLayer */
  status: NodeRuntimeStatus;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  /** Merged from latest active ResultLayer */
  result?: NodeResult;
  /** Reason why node is blocked or waiting */
  blockedReason?: string;
  /** Engine-level metadata (e.g. linkedTaskId for materialized child tasks) */
  metadata: Record<string, unknown>;
  /** Computed: all dependencies are completed/skipped */
  dependenciesSatisfied: boolean;
  /** Computed: can be executed now */
  ready: boolean;
  /** Computed: whether this node is still reachable in the selected branch path */
  reachable: boolean;
}

export interface EffectivePlanEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  active: boolean;
}

export interface EffectivePlanGraph {
  graphId: string;
  basePlanId: string;
  resolvedAt: string;
  resolvedVersion: number;
  nodes: EffectivePlanNode[];
  edges: EffectivePlanEdge[];
  /** Computed: nodes with no incoming edges */
  entryNodeIds: string[];
  /** Computed: nodes with no outgoing edges */
  terminalNodeIds: string[];
  /** Denormalized subsets for fast runtime lookup */
  readyNodeIds: string[];
  blockedNodeIds: string[];
  waitingNodeIds: string[];
  waitingForUserNodeIds: string[];
  waitingForApprovalNodeIds: string[];
  degradedNodeIds: string[];
  skippedNodeIds: string[];
  cancelledNodeIds: string[];
  completedNodeIds: string[];
  runningNodeIds: string[];
  invalidatedNodeIds: string[];
  failedNodeIds: string[];
  pendingNodeIds: string[];
}

export interface ResolveEffectivePlanGraphInput {
  graph: PlanGraph;
  attempts?: NodeAttempt[];
  results?: NodeResult[];
}

import type { NodeAttempt } from "./execution";
import type { ResultLayer, RuntimeLayer, StructuralLayer } from "./layers";
import type { NodeResult, NodeRuntimeStatus } from "./runtime";

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

export type PlanNodeType = "task" | "checkpoint" | "condition" | "wait";

export type TaskExecutionMode = "manual" | "assist" | "auto";

export type TaskMode = TaskExecutionMode;

export type TaskExecutor = "user" | "ai" | "system";

export interface TaskConfig {
  expectedOutput?: string;
  completionCriteria?: string;
}

export interface CheckpointConfig {
  checkpointType: string;
  prompt: string;
  required: boolean;
  options?: string[];
  inputFields?: Array<{
    name: string;
    label: string;
    type?: string;
    required?: boolean;
    options?: string[];
  }>;
}

export interface ConditionConfig {
  condition: string;
  evaluationBy: string;
  branches: Array<{
    label: string;
    nextNodeId: string;
  }>;
  defaultNextNodeId?: string;
}

export interface WaitConfig {
  waitFor: string;
  timeout?: {
    minutes: number;
    onTimeout: string;
  };
}

export type NodeConfig = TaskConfig | CheckpointConfig | ConditionConfig | WaitConfig;

export interface CompiledNode {
  id: string;
  localId: string;
  type: PlanNodeType;
  title: string;
  description?: string;
  priority?: TaskPriority;
  linkedTaskId?: string;
  config: NodeConfig;
  dependencies: string[];
  dependents: string[];
  executor?: TaskExecutor;
  mode?: TaskExecutionMode;
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
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  entryNodeIds: string[];
}

export type PlanGraphStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "superseded"
  | "archived";

export type DependencyEdgeType = "hard_dependency" | "ordering";
export type ContextEdgeType = "context";
export type GateEdgeType = "review_gate";
export type BranchEdgeType = "branch";

export type EdgeType = DependencyEdgeType | ContextEdgeType | GateEdgeType | BranchEdgeType;

export type PlanEdgeType = EdgeType;

export type PlanNodeLayerType = "definition" | "invalidation" | "cancellation";

export type NodeLayerType = PlanNodeLayerType;

export type LayerSource = "user" | "ai" | "system";

export type WaitKind =
  | "user_input"
  | "approval"
  | "review"
  | "manual_action"
  | "external_dependency"
  | "capability_unavailable";

export interface NodeDefinition {
  title: string;
  objective: string;
  description?: string;
  semantics: {
    type: PlanNodeType;
    priority?: TaskPriority;
    mode?: TaskExecutionMode;
    linkedTaskId?: string;
    metadata?: Record<string, unknown>;
  };
  executor?: TaskExecutor;
  inputContract?: Record<string, unknown> | null;
  outputContract?: Record<string, unknown> | null;
  reviewRequired?: boolean;
  estimatedMinutes?: number;
  metadata?: Record<string, unknown>;
}

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

export type PlanNodeLayer = NodeDefinitionLayer | NodeInvalidationLayer | NodeCancellationLayer;

export type NodeLayer = PlanNodeLayer;

export interface PlanNode {
  id: string;
  semanticKey: string;
  layers: PlanNodeLayer[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
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
      layer: PlanNodeLayer;
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

export interface EffectivePlanNode {
  id: string;
  nodeId: string;
  activeLayerId: string | null;
  semanticKey: string;
  definition: NodeDefinition;
  invalidated: boolean;
  invalidationReason?: string;
  waitKind?: WaitKind;
  reviewRequired?: boolean;
  localId: string;
  type: PlanNodeType;
  title: string;
  description?: string;
  priority?: TaskPriority;
  linkedTaskId?: string;
  config: NodeConfig;
  executor?: TaskExecutor;
  mode?: TaskExecutionMode;
  estimatedMinutes?: number;
  dependencies: string[];
  dependents: string[];
  status: NodeRuntimeStatus;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  result?: NodeResult;
  blockedReason?: string;
  metadata: Record<string, unknown>;
  dependenciesSatisfied: boolean;
  ready: boolean;
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
  planId: string;
  basePlanId: string;
  resolvedAt: string;
  resolvedVersion: number;
  nodes: EffectivePlanNode[];
  edges: EffectivePlanEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
  readyNodeIds: string[];
  blockedNodeIds: string[];
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

export type PlanOverlayLayer = StructuralLayer | RuntimeLayer | ResultLayer;

export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

import type {
  PlanBlueprint,
  ValidationWarning,
  TaskExecutor,
  TaskMode,
  CompiledPlanCompletionPolicy,
} from "./ai-plan-blueprint";

// ═══════════════════════════════════════════════════════════════
// Layer 3: CompiledPlan (backend-compiled execution graph)
// ═══════════════════════════════════════════════════════════════

// ─── Node configs ───

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

// ─── Compiled types ───

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
// Layer 4: PlanRun (execution runtime state)
// ═══════════════════════════════════════════════════════════════

export type PlanRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type NodeRuntimeStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeRuntimeStatus;
  attempts: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CheckpointResponse {
  id: string;
  planRunId: string;
  nodeId: string;
  response: unknown;
  submittedAt: string;
}

export interface ArtifactRef {
  id: string;
  planRunId: string;
  nodeId: string;
  artifactType: string;
  artifactId: string;
  metadata?: unknown;
}

export interface NodeExecutionAttempt {
  id: string;
  planRunId: string;
  nodeId: string;
  attemptNumber: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  inputSnapshot?: unknown;
  outputSnapshot?: unknown;
  toolCalls?: unknown[];
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  startedAt: string;
  finishedAt?: string;
}

export interface PlanRun {
  id: string;
  compiledPlanId: string;
  editablePlanId: string;
  sourceVersion: number;
  status: PlanRunStatus;
  nodeStates: Record<string, NodeRuntimeState>;
  checkpointResponses: CheckpointResponse[];
  artifactRefs: ArtifactRef[];
  attempts: NodeExecutionAttempt[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ═══════════════════════════════════════════════════════════════
// Runtime commands
// ═══════════════════════════════════════════════════════════════

export type RuntimeCommand =
  | { type: "start_plan" }
  | { type: "pause_plan" }
  | { type: "resume_plan" }
  | { type: "cancel_plan" }
  | { type: "mark_user_task_completed"; nodeId: string }
  | { type: "approve_checkpoint"; nodeId: string; response?: unknown }
  | { type: "reject_checkpoint"; nodeId: string; reason?: string }
  | { type: "retry_node"; nodeId: string };

// ═══════════════════════════════════════════════════════════════
// Layer 5: Plan Overlay Model (EffectivePlanGraph)
// ═══════════════════════════════════════════════════════════════
//
// CompiledPlanBase is the immutable base graph (CompiledPlan).
// All mutations, state, and results are append-only overlay
// layers stacked on top.
//
//   CompiledPlanBase
//     + StructuralLayer(s)
//     + RuntimeLayer(s)
//     + ResultLayer(s)
//     = EffectivePlanGraph
//
// PlanRunner reads resolve() output; never mutates base or
// layers directly.

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
  nodeStates: Record<string, Pick<NodeRuntimeState, "status"> & Partial<Pick<NodeRuntimeState, "attempts" | "lastError" | "startedAt" | "completedAt">>>;
}

// ─── Result Layer (execution output) ───

export interface NodeResult {
  outputSummary?: string;
  artifactRefs?: ArtifactRef[];
  checkpointResponse?: CheckpointResponse["response"];
  error?: string;
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
  /** Stable compiled node ID */
  id: string;
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
}

export interface EffectivePlanEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface EffectivePlanGraph {
  planId: string;
  basePlanId: string;
  /** max(activeLayers.version) */
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
  completedNodeIds: string[];
  runningNodeIds: string[];
  failedNodeIds: string[];
  pendingNodeIds: string[];
}

// ═══════════════════════════════════════════════════════════════
// Legacy types retained for backward compatibility
// These are the types used by the engine execution layer,
// API routes, AI features, and existing tests.
// TODO: migrate all consumers to CompiledPlan / PlanRun
// ═══════════════════════════════════════════════════════════════

export interface GenerateTaskPlanRequest {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: Date | string | null;
  estimatedMinutes?: number;
  planningPrompt?: string;
}

export type TaskPlanStatus = "draft" | "accepted" | "superseded" | "archived";
export type TaskPlanNodeType = "task" | "checkpoint" | "condition" | "wait";
export type TaskPlanNodeStatus =
  | "pending"
  | "in_progress"
  | "waiting_for_child"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "done"
  | "skipped";
export type TaskPlanEdgeType = "sequential" | "depends_on";
export type TaskPlanNodeExecutionMode = "automatic" | "manual" | "hybrid";
export type TaskPlanNodeBlockingReason =
  | "needs_user_input"
  | "needs_approval"
  | "external_dependency"
  | null;

export type TaskPlanNodeExecutionClassification =
  | "automatic_chainable"
  | "automatic_standalone"
  | "human_dependent"
  | "review_gate";

export type TaskPlanNodeReadiness = "ready" | "blocked" | "waiting";

/** @deprecated Use CompiledNode instead */
export type TaskPlanNode = {
  id: string;
  localId?: string;
  type: TaskPlanNodeType;
  title: string;
  objective: string;
  description: string | null;
  status: TaskPlanNodeStatus;
  phase: string | null;
  estimatedMinutes: number | null;
  priority: "Low" | "Medium" | "High" | "Urgent" | null;
  executionMode: TaskPlanNodeExecutionMode;
  requiresHumanInput: boolean;
  requiresHumanApproval: boolean;
  autoRunnable: boolean;
  blockingReason: TaskPlanNodeBlockingReason;
  linkedTaskId: string | null;
  completionSummary: string | null;
  metadata: Record<string, unknown> | null;
  requiredInfo?: string[];
  dependencies?: string[];
  executionClassification?: TaskPlanNodeExecutionClassification;
  nextAction?: string | null;
  readiness?: TaskPlanNodeReadiness;
};

/** @deprecated Use CompiledEdge instead */
export type TaskPlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: TaskPlanEdgeType;
  metadata: Record<string, unknown> | null;
};

/** @deprecated Use CompiledPlan instead */
export type TaskPlanGraph = {
  id: string;
  taskId: string;
  status: TaskPlanStatus;
  revision: number;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  prompt: string | null;
  summary: string | null;
  changeSummary: string | null;
  blueprint?: PlanBlueprint;
  completionPolicy?: CompiledPlanCompletionPolicy;
  entryNodeIds?: string[];
  terminalNodeIds?: string[];
  createdAt: string;
  updatedAt: string;
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
};

export interface SavedTaskPlanGraph {
  id: string;
  taskId: string | null;
  workspaceId: string;
  status: TaskPlanStatus;
  prompt: string | null;
  revision: number;
  summary: string | null;
  changeSummary: string | null;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  plan: TaskPlanGraph;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPlanGraphResponse {
  source: "saved" | string;
  planGraph: TaskPlanGraph;
  taskSessionKey?: string | null;
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
}

export type TaskUpdatePatch = {
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  scheduleStatus?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: Record<string, unknown> | null;
  runtimeInput?: unknown;
};

/** @deprecated Use PlanPatch + PlanPatchOperation from ai-plan-blueprint instead */
export type PlanUpdatePatch = {
  summary?: string;
  operation:
    | "replace_plan"
    | "update_plan_summary"
    | "add_node"
    | "update_node"
    | "delete_node"
    | "reorder_nodes"
    | "update_dependencies"
    | "materialize_child_tasks"
    | "custom";
  planId?: string;
  baseRevisionId?: string;
  nodes?: Array<{
    id?: string;
    title: string;
    description?: string;
    status?: string;
    estimatedDurationMinutes?: number;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
  }>;
  edges?: Array<{
    from: string;
    to: string;
    type?: string;
  }>;
  nodePatches?: Array<{
    nodeId: string;
    patch: Record<string, unknown>;
  }>;
  deletedNodeIds?: string[];
  reorder?: Array<{
    nodeId: string;
    position: number;
  }>;
  warnings?: string[];
};

export type TaskWorkspaceUpdateProposal = {
  summary: string;
  confidence: "low" | "medium" | "high";
  taskPatch?: TaskUpdatePatch;
  planPatch?: PlanUpdatePatch;
  warnings?: string[];
  requiresConfirmation: boolean;
};

export interface TaskWorkspaceChatRequest {
  taskId: string;
  message: string;
  currentTask: {
    title: string;
    description: string | null;
    priority: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    scheduleStatus: string;
    runtimeModel: string | null;
    prompt: string | null;
    runtimeConfig: unknown;
    status: string;
  };
  currentPlan?: {
    id: string;
    status: string;
    revision: number;
    summary: string | null;
    nodes: Array<{
      id: string;
      title: string;
      objective: string;
      description: string | null;
      status: string;
      estimatedMinutes: number | null;
      priority: string | null;
      executionMode: string;
      dependsOn?: string[];
    }>;
    edges: Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      type: string;
    }>;
  } | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  enablePatchTools?: boolean;
}

export interface TaskWorkspaceChatResponse {
  assistantMessage: string;
  proposal?: TaskWorkspaceUpdateProposal;
}

export type ExecutionSessionStatus = "Active" | "Paused" | "Completed" | "Abandoned";
export type ExecutionSessionPauseReason =
  | "needs_user_input"
  | "needs_approval"
  | "external_dependency"
  | "provider_unavailable"
  | null;

export interface ExecutionSession {
  id: string;
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  planId: string;
  status: ExecutionSessionStatus;
  currentNodeId: string | null;
  pauseReason: ExecutionSessionPauseReason;
  completedNodeIds: string[];
  startedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionSessionResponse {
  session: ExecutionSession;
  currentStep: TaskPlanNode | null;
  nextEligibleSteps: TaskPlanNode[];
  reviewPending: boolean;
}

export type ReviewOutcome = "accept" | "reject" | "request_changes";

export interface StepReviewInput {
  taskId: string;
  nodeId: string;
  outcome: ReviewOutcome;
  feedback?: string;
}

export interface StepReviewResponse {
  nodeId: string;
  outcome: ReviewOutcome;
  feedback: string | null;
  nextAction: string | null;
}

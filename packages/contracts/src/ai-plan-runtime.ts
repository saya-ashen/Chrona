export type TaskPriority = "Low" | "Medium" | "High" | "Urgent";

import type {
  PlanBlueprint,
  PlanPatch,
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

export type NodeLayerType = "definition" | "invalidation" | "cancellation";

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
    type: "task" | "checkpoint" | "condition" | "wait";
    priority?: TaskPriority;
    mode?: TaskMode;
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

// ═══════════════════════════════════════════════════════════════
// Layer 4: PlanRun (execution runtime state)
// ═══════════════════════════════════════════════════════════════

export type PlanRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type NodeRuntimeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "invalidated"
  | "skipped";

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeRuntimeStatus;
  attempts: number;
  linkedTaskId?: string;
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

export type NodeResultOutput =
  | { kind: "text"; content: string; title?: string }
  | { kind: "markdown"; content: string; title?: string }
  | { kind: "json"; value: unknown; title?: string }
  | {
      kind: "file";
      path: string;
      title?: string;
      language?: string;
      description?: string;
    }
  | { kind: "artifact"; artifactId: string; title: string; description?: string }
  | {
      kind: "command";
      command: string;
      title?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    }
  | { kind: "link"; href: string; title: string; description?: string };

export interface NodeResultEvidence {
  sessionId?: string;
  runId?: string;
  runtimeName?: string;
  runtimeRunRef?: string | null;
  artifactIds?: string[];
  conversationEntryIds?: string[];
  eventIds?: string[];
}

export interface ArtifactRef {
  id: string;
  planRunId: string;
  nodeId: string;
  artifactType: string;
  artifactId: string;
  metadata?: unknown;
}

export interface ExecutionContextSnapshot {
  id: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  graphSignature: string;
  refs?: Record<string, unknown>;
  promptSnapshot?: Record<string, unknown>;
  modelSnapshot?: Record<string, unknown>;
  runtimeSnapshot?: Record<string, unknown>;
  createdAt: string;
}

export interface NodeExecutionAttempt {
  id: string;
  planRunId: string;
  nodeId: string;
  nodeLayerId?: string;
  executionContextSnapshotId?: string;
  idempotencyKey?: string;
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

export interface NodeAttempt {
  id: string;
  taskId: string;
  graphId: string;
  nodeId: string;
  nodeLayerId: string;
  executionContextSnapshotId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  idempotencyKey: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  runtimeSnapshot?: Record<string, unknown>;
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
  nodeStates: Record<string, Pick<NodeRuntimeState, "status"> & Partial<Pick<NodeRuntimeState, "attempts" | "linkedTaskId" | "lastError" | "startedAt" | "completedAt">>>;
}

// ─── Result Layer (execution output) ───

export interface NodeResult {
  id?: string;
  taskId?: string;
  graphId?: string;
  nodeId?: string;
  nodeLayerId?: string;
  attemptId?: string;
  status?: "current" | "stale" | "obsolete" | "invalidated" | "rejected";
  outputSummary?: string;
  outputs?: NodeResultOutput[];
  evidence?: NodeResultEvidence;
  artifactRefs?: ArtifactRef[];
  checkpointResponse?: CheckpointResponse["response"];
  error?: string;
  errorDetails?: unknown;
  waitKind?: WaitKind;
  review?: {
    required: boolean;
    status: "pending" | "accepted" | "rejected" | "request_changes";
    feedback?: string;
    reviewedAt?: string;
    reviewedBy?: string;
  };
  selectedBranch?: {
    label: string;
    nextNodeId: string;
    source: "user" | "ai" | "system" | "default";
  };
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
  /** Compatibility alias until callers are migrated. */
  planId: string;
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

export type ExecutionActionType =
  | "start_manual"
  | "start_scheduled"
  | "resume_with_input"
  | "resume_with_approval"
  | "resume_after_unblock"
  | "complete_manual_node"
  | "retry_node"
  | "cancel_session";

export type ExecutionActionInput =
  | {
      action: "start_manual";
      prompt?: string;
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "start_scheduled";
      workBlockId?: string;
      idempotencyKey?: string;
    }
  | {
      action: "resume_with_input";
      sessionId?: string;
      nodeId?: string;
      inputText: string;
      idempotencyKey?: string;
    }
  | {
      action: "resume_with_approval";
      sessionId?: string;
      nodeId?: string;
      decision: "approve" | "reject" | "request_changes";
      feedback?: string;
      editedContent?: string;
      idempotencyKey?: string;
    }
  | {
      action: "resume_after_unblock";
      sessionId?: string;
      nodeId?: string;
      note?: string;
      idempotencyKey?: string;
    }
  | {
      action: "complete_manual_node";
      sessionId?: string;
      nodeId: string;
      summary?: string;
      output?: unknown;
      idempotencyKey?: string;
    }
  | {
      action: "retry_node";
      sessionId?: string;
      nodeId: string;
      prompt?: string;
      idempotencyKey?: string;
    }
  | {
      action: "cancel_session";
      sessionId?: string;
      reason?: string;
      idempotencyKey?: string;
    };

export type PlanExecutionStatus =
  | "started"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "completed"
  | "cancelled"
  | "no_plan";

export type PlanExecutionResult = {
  taskId: string;
  planId: string | null;
  mainSessionId: string | null;
  status: PlanExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  message: string;
  errorDetails?: unknown;
};

export type PlanExecutionSSEEvent =
  | {
      type: "status";
      action: ExecutionActionType;
      message: string;
    }
  | {
      type: "graph_event";
      event: string;
      nodeId?: string;
      nodeTitle?: string;
      status?: string;
      message?: string;
    }
  | {
      type: "state";
      effectivePlan: EffectivePlanGraph;
    }
  | {
      type: "result";
      result: PlanExecutionResult;
    }
  | {
      type: "error";
      code: "INTERNAL_ERROR";
      message: string;
    }
  | {
      type: "done";
    };

export type GraphMutationRequest = {
  expectedGraphId?: string;
  expectedRevision?: number;
  reason: string;
  operations: GraphMutationOperation[];
  scope?: "future_only" | "from_node" | "entire_graph";
};

export interface GenerateTaskPlanRequest {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: Date | string | null;
  estimatedMinutes?: number;
  planningPrompt?: string | null;
  sessionKey?: string;
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════
// TaskPlanReadModel — canonical frontend-facing stable shape
// ═══════════════════════════════════════════════════════════════

export interface TaskPlanReadModel {
  id: string;
  status: "draft" | "accepted" | "superseded" | "archived";
  revision: number;
  prompt: string | null;
  summary: string | null;
  updatedAt: string;
  generatedBy: string | null;
  blueprint: PlanBlueprint;
  compiledPlan: CompiledPlan;
  effectivePlan: EffectivePlanGraph;
}

// ═══════════════════════════════════════════════════════════════
// Manual generation SSE event types
// ═══════════════════════════════════════════════════════════════

export type GeneratePlanStatusPhase =
  | "starting"
  | "loading_task"
  | "requesting_provider"
  | "streaming"
  | "extracting_tool_payload"
  | "compiling"
  | "saving"
  | "completed";

export interface GeneratePlanStatusEvent {
  type: "status";
  phase: GeneratePlanStatusPhase;
  message: string;
}

export interface GeneratePlanPartialEvent {
  type: "partial";
  text: string;
}

export interface GeneratePlanToolCallEvent {
  type: "tool_call";
  tool: "chrona_plan_generate";
  input: PlanBlueprint;
}

export interface GeneratePlanResultEvent {
  type: "result";
  result: TaskPlanReadModel;
  taskSessionKey?: string;
}

export interface GeneratePlanCancelledEvent {
  type: "cancelled";
}

export interface TaskPlanGenerationSessionReadModel {
  generationId: string;
  taskId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  phase: GeneratePlanStatusPhase | null;
  statusMessage: string | null;
  partialText: string;
  result: TaskPlanReadModel | null;
  error: {
    code: GeneratePlanErrorCode;
    message: string;
    rawText?: string;
    diagnostics?: Record<string, unknown>;
  } | null;
  startedAt: string;
  finishedAt: string | null;
}

export type GeneratePlanErrorCode =
  | "TASK_NOT_FOUND"
  | "PLAN_GENERATION_IN_FLIGHT"
  | "NO_AI_CLIENT"
  | "INVALID_TOOL_PAYLOAD"
  | "EMPTY_PLAN"
  | "PROVIDER_ERROR"
  | "ABORTED"
  | "INTERNAL_ERROR";

export interface GeneratePlanErrorEvent {
  type: "error";
  code: GeneratePlanErrorCode;
  message: string;
  rawText?: string;
  diagnostics?: Record<string, unknown>;
}

export interface GeneratePlanDoneEvent {
  type: "done";
}

export type GeneratePlanSSEEvent =
  | GeneratePlanStatusEvent
  | GeneratePlanPartialEvent
  | GeneratePlanToolCallEvent
  | GeneratePlanResultEvent
  | GeneratePlanCancelledEvent
  | GeneratePlanErrorEvent
  | GeneratePlanDoneEvent;

// ═══════════════════════════════════════════════════════════════
// Manual generation request
// ═══════════════════════════════════════════════════════════════

export interface GenerateTaskPlanApiRequest {
  forceRefresh?: boolean;
  planningPrompt?: string | null;
}

/** @deprecated Replaced by TaskPlanReadModel + GeneratePlanSSEEvent */
export interface TaskPlanGraphResponse {
  taskSessionKey?: string;
}

export type TaskUpdatePatch = {
  title?: string;
  description?: string | null;
  priority?: "Low" | "Medium" | "High" | "Urgent";
  dueAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  scheduleStatus?: string | null;
  executionRuntime?: "openclaw" | "research" | null;
  executionConfig?: Record<string, unknown> | null;
};

export type TaskWorkspaceUpdateProposal = {
  summary: string;
  confidence: "low" | "medium" | "high";
  taskPatch?: TaskUpdatePatch;
  planPatch?: PlanPatch;
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
    executionRuntime: "openclaw" | "research";
    executionConfig: unknown;
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

export type ExecutionSessionStatus =
  | "pending"
  | "running"
  | "paused"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type ExecutionSessionTrigger = "manual" | "scheduled" | "system" | "retry";

export type ExecutionSessionPauseReason = WaitKind | "work_block_exhausted" | "replan_confirmation" | null;

export interface ExecutionSession {
  id: string;
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  graphId: string;
  /** Compatibility alias until callers migrate from planId. */
  planId: string;
  status: ExecutionSessionStatus;
  trigger: ExecutionSessionTrigger;
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
  currentStep?: { nodeId: string; title: string } | null;
  nextEligibleSteps?: Array<{ nodeId: string; title: string }>;
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

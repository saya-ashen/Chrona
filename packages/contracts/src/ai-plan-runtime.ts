import type { CompiledPlanCompletionPolicy, PlanBlueprint } from "./ai-plan-blueprint";

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
export type TaskPlanNodeBlockingReason = "needs_user_input" | "needs_approval" | "external_dependency" | null;

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

export type TaskPlanNodeExecutionClassification =
  | "automatic_chainable"
  | "automatic_standalone"
  | "human_dependent"
  | "review_gate";

export type TaskPlanNodeReadiness = "ready" | "blocked" | "waiting";

export type TaskPlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: TaskPlanEdgeType;
  metadata: Record<string, unknown> | null;
};

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

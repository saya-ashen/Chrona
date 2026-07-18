// Shared leaf types for the plan-runtime package. Living here
// (not included in plan-runtime/index.ts's `export *` chain) lets
// the originally-cycling siblings (checkpoints, graph, events,
// attempts) drop their back-edge `import type` references to
// execution-state.ts without affecting any external consumer
// (200+ files import these names via @chrona/contracts/ai barrel,
// which re-aggregates them from the original home files that
// re-export from here).
//
// This file is a true leaf in the type graph: it imports only
// from `../ai-plan-blueprint` and from the truly leaf files
// (`./node`, `./node-result`, `./attempts` for ExecutionContextSnapshot)
// — none of which ever import back from plan-runtime siblings.

import type {
  CompiledPlanCompletionPolicy,
  TaskExecutor,
  TaskMode,
  ValidationWarning,
} from "../ai-plan-blueprint";
import type {
  NodeActionFormField,
  NodeConfig,
  NodeDefinition,
  TaskPriority,
  WaitKind,
} from "./node";
import type { NodeResult } from "./node-result";

// Inline status enum so this file does not need to import from
// ./execution-state. The status union itself is part of the public
// surface and re-exported from execution-state.ts as well, so the
// public type identity is preserved by TypeScript's structural
// typing.
export type NodeRuntimeStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "degraded"
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

// ─── Checkpoint shared types (originally from checkpoints.ts) ───────

export type CheckpointFieldValue = string | boolean | string[];
export type CheckpointInputFields = Record<string, CheckpointFieldValue>;

export interface CheckpointResponse {
  id: string;
  planRunId: string;
  nodeId: string;
  response: unknown;
  submittedAt: string;
}

export type ExecutionCheckpointKind =
  | "user_input"
  | "approval"
  | "review"
  | "replan_required"
  | "blocked"
  | "failed"
  | "manual_recovery"
  | "external_dependency";

export type CheckpointActionKind =
  | "submit_input"
  | "approve_result"
  | "reject_result"
  | "request_changes"
  | "request_replan"
  | "accept_replan"
  | "reject_replan"
  | "retry_node"
  | "resume_after_unblock"
  | "mark_node_completed"
  | "mark_node_skipped"
  | "cancel_session"
  | "fail_task";

export type CheckpointFormField = NodeActionFormField & {
  value?: string;
};

export interface CheckpointForm {
  instructions: string;
  submitLabel?: string;
  inputFields: CheckpointFormField[];
}

export interface CheckpointAction {
  id: CheckpointActionKind;
  label: string;
  style: "primary" | "secondary" | "danger";
  requiresPayload?: boolean;
  payloadSchema?: unknown;
}

export interface ExecutionCheckpoint {
  id: string;
  taskId: string;
  sessionId: string;
  planRunId: string;
  nodeId: string | null;
  kind: ExecutionCheckpointKind;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  form?: CheckpointForm;
  availableActions: CheckpointAction[];
  createdAt: string;
}

// ─── Graph compiled/effective (originally from graph.ts) ─────────────

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
  type: "task" | "checkpoint" | "condition" | "wait";
  title: string;
  description?: string;
  priority?: TaskPriority;
  linkedTaskId?: string;
  config: NodeConfig;
  executor?: TaskExecutor;
  mode?: TaskMode;
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
  basePlanId: string;
  resolvedAt: string;
  resolvedVersion: number;
  nodes: EffectivePlanNode[];
  edges: EffectivePlanEdge[];
  entryNodeIds: string[];
  terminalNodeIds: string[];
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

export type PlanGraphStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "superseded"
  | "archived";

// ─── Attempts (originally from attempts.ts) ─────────────────────────

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

// ─── Events (originally from events.ts) ─────────────────────────────

export type GeneratePlanStatusPhase =
  | "starting"
  | "loading_task"
  | "requesting_provider"
  | "streaming"
  | "extracting_tool_payload"
  | "compiling"
  | "saving"
  | "completed";

export type GeneratePlanErrorCode =
  | "TASK_NOT_FOUND"
  | "PLAN_GENERATION_IN_FLIGHT"
  | "NO_AI_CLIENT"
  | "INVALID_TOOL_PAYLOAD"
  | "EMPTY_PLAN"
  | "PROVIDER_ERROR"
  | "ABORTED"
  | "INTERNAL_ERROR";

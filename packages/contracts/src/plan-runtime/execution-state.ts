import type { PlanBlueprint } from "../ai-plan-blueprint";
import type { PublicEffectivePlanGraph } from "./public-effective-plan";
import type { WaitKind } from "./node";
import type { ArtifactRef } from "./node-result";
import type {
  CheckpointResponse,
  CompiledPlan,
  PlanGraphStatus,
  NodeExecutionAttempt,
  GeneratePlanErrorCode,
  GeneratePlanStatusPhase,
} from "./_leaf";
export type { PlanExecutionResult, PlanExecutionStatus, PublicExecutionCheckpoint, PublicPlanExecutionResult } from "./_leaf";

export type PlanRunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

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

export type RuntimeProgressStatus =
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled";

export type ExecutionSessionLifecycleStatus =
  | "Active"
  | "Paused"
  | "Completed"
  | "Abandoned";

export type TaskExecutionAggregateStatus =
  | "Running"
  | "WaitingForInput"
  | "WaitingForApproval"
  | "Blocked"
  | "Failed"
  | "Completed"
  | "Cancelled";

export type WebPlanNodeStatus =
  | "idle"
  | "ready"
  | "active"
  | "waiting"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "degraded"
  | "done"
  | "skipped"
  | "cancelled"
  | "invalidated";

const WEB_PLAN_NODE_STATUS_BY_RUNTIME_STATUS = {
  pending: "idle",
  ready: "ready",
  running: "active",
  waiting: "waiting",
  waiting_for_user: "waiting_for_user",
  waiting_for_approval: "waiting_for_approval",
  blocked: "blocked",
  degraded: "degraded",
  completed: "done",
  failed: "failed",
  cancelled: "cancelled",
  invalidated: "invalidated",
  skipped: "skipped",
} as const satisfies Record<NodeRuntimeStatus, WebPlanNodeStatus>;

export function webPlanNodeStatusForRuntimeStatus(
  status: NodeRuntimeStatus | null | undefined,
): WebPlanNodeStatus {
  return status === null || status === undefined ? "idle" : WEB_PLAN_NODE_STATUS_BY_RUNTIME_STATUS[status];
}

export function runtimeProgressStatusForWaitKind(
  waitKind: WaitKind | undefined,
): Extract<RuntimeProgressStatus, "waiting_for_user" | "waiting_for_approval" | "blocked"> {
  switch (waitKind) {
    case "user_input":
    case "manual_completion":
      return "waiting_for_user";
    case "approval":
    case "review":
    case "replan_required":
      return "waiting_for_approval";
    case undefined:
    case "manual_action":
    case "external_dependency":
    case "capability_unavailable":
    default:
      return "blocked";
  }
}

export function runtimeProgressStatusForNodes(input: {
  readyNodeIds: readonly string[];
  runningNodeIds: readonly string[];
  nodes: readonly { status: NodeRuntimeStatus; reachable?: boolean; id?: string }[];
  blockedNodeIds: readonly string[];
  failedNodeIds: readonly string[];
  completedNodeIds: readonly string[];
}): RuntimeProgressStatus {
  if (input.readyNodeIds.length > 0 || input.runningNodeIds.length > 0) {
    return "running";
  }
  if (input.nodes.some((node) => node.status === "waiting_for_user")) {
    return "waiting_for_user";
  }
  if (input.nodes.some((node) => node.status === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (input.failedNodeIds.length > 0) {
    return "failed";
  }
  if (input.blockedNodeIds.length > 0) {
    return "blocked";
  }

  const reachableNodes = input.nodes.filter((node) => node.reachable !== false);
  if (
    reachableNodes.length > 0 &&
    reachableNodes.every((node) =>
      node.id ? input.completedNodeIds.includes(node.id) : node.status === "completed",
    )
  ) {
    return "completed";
  }

  return "blocked";
}

export function planRunStatusForRuntimeProgress(
  status: RuntimeProgressStatus,
): PlanRunStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "running":
      return "running";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
      return "paused";
  }
}

export function planGraphStatusForRuntimeProgress(
  status: RuntimeProgressStatus,
): PlanGraphStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "paused";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
      return "paused";
    case "running":
      return "active";
  }
}

export function executionSessionStatusForRuntimeProgress(
  status: RuntimeProgressStatus,
): ExecutionSessionLifecycleStatus {
  switch (status) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Abandoned";
    case "failed":
      return "Paused";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
      return "Paused";
    case "running":
      return "Active";
  }
}

export function taskStatusForRuntimeProgress(
  status: RuntimeProgressStatus,
): TaskExecutionAggregateStatus {
  switch (status) {
    case "running":
      return "Running";
    case "waiting_for_user":
      return "WaitingForInput";
    case "waiting_for_approval":
      return "WaitingForApproval";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeRuntimeStatus;
  attempts: number;
  linkedTaskId?: string;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
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
  effectivePlan: PublicEffectivePlanGraph;
}

export interface TaskPlanGenerationSessionReadModel {
  generationId: string;
  taskId: string;
  headStateVersion: number;
  status: "running" | "completed" | "failed" | "cancelled";
  phase: GeneratePlanStatusPhase | null;
  statusMessage: string | null;
  error: {
    code: GeneratePlanErrorCode | "STALE_GENERATION";
    title?: string;
    /** Stable durable-runtime error code; it is not a feature-run identifier. */
    persistedCode?: string;
    message: string;
  } | null;
  startedAt: string;
  finishedAt: string | null;
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

export type ExecutionSessionPauseReason = WaitKind | "work_block_exhausted" | null;

export interface ExecutionSession {
  id: string;
  workspaceId: string;
  taskId: string;
  workBlockId: string | null;
  graphId: string;
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

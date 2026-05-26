import type { PlanBlueprint } from "../ai-plan-blueprint";
import type { CheckpointResponse, ExecutionCheckpoint } from "./checkpoints";
import type { CompiledPlan, EffectivePlanGraph, PlanGraphStatus } from "./graph";
import type { ArtifactRef } from "./node-result";
import type { NodeExecutionAttempt } from "./attempts";
import type { WaitKind } from "./node";
import type { GeneratePlanErrorCode, GeneratePlanStatusPhase } from "./events";

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

export function webPlanNodeStatusForRuntimeStatus(
  status: NodeRuntimeStatus | null | undefined,
): WebPlanNodeStatus {
  switch (status) {
    case "running":
      return "active";
    case "waiting_for_approval":
      return "waiting_for_approval";
    case "waiting_for_user":
      return "waiting_for_user";
    case "waiting":
      return "waiting";
    case "degraded":
      return "degraded";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "invalidated":
      return "invalidated";
    case "ready":
      return "ready";
    case "pending":
    default:
      return "idle";
  }
}

export function runtimeProgressStatusForWaitKind(
  waitKind: WaitKind | undefined,
): Extract<RuntimeProgressStatus, "waiting_for_user" | "waiting_for_approval" | "blocked"> {
  switch (waitKind) {
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
    case "replan_required":
      return "waiting_for_approval";
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

export type PlanExecutionStatus =
  | "started"
  | "running"
  | "waiting_for_user"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "completed"
  | "cancelled"
  | "no_plan";

export type PlanExecutionResult = {
  taskId: string;
  planId: string | null;
  mainSessionId: string | null;
  executionSessionId?: string | null;
  planRunId?: string | null;
  status: PlanExecutionStatus;
  currentNodeId: string | null;
  executedNodeIds: string[];
  waitingNodeIds: string[];
  blockedNodeIds: string[];
  message: string;
  checkpoint: ExecutionCheckpoint | null;
  errorDetails?: unknown;
};

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

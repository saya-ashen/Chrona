import { Prisma, TaskStatus } from "@/generated/prisma/client";
import type { GraphDispatchOutcome } from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  PlanExecutionStatus,
  PlanGraph,
  PlanRun,
  WaitKind,
} from "@chrona/contracts/ai";

export type ExecutionPauseReason = WaitKind;

export type ExecutionTransition = {
  status: PlanExecutionStatus;
  taskStatus: TaskStatus;
  sessionStatus: "Active" | "Paused" | "Completed" | "Abandoned";
  planRunStatus: PlanRun["status"];
  graphStatus: PlanGraph["status"];
  pauseReason: ExecutionPauseReason | null;
  blockReason: Prisma.InputJsonValue | typeof Prisma.DbNull;
};

export function executionStatusFromEffectiveGraph(
  effective: EffectivePlanGraph,
): PlanExecutionStatus {
  if (effective.readyNodeIds.length > 0 || effective.runningNodeIds.length > 0) {
    return "running";
  }
  if (effective.nodes.some((node) => node.status === "waiting_for_user")) {
    return "waiting_for_user";
  }
  if (effective.nodes.some((node) => node.status === "waiting_for_approval")) {
    return "waiting_for_approval";
  }
  if (effective.failedNodeIds.length > 0) {
    return "failed";
  }
  if (effective.blockedNodeIds.length > 0) {
    return "blocked";
  }

  const reachableNodes = effective.nodes.filter((node) => node.reachable !== false);
  if (
    reachableNodes.length > 0 &&
    reachableNodes.every((node) => effective.completedNodeIds.includes(node.id))
  ) {
    return "completed";
  }

  return "blocked";
}

export function executionStatusFromWaitKind(waitKind: WaitKind | undefined): PlanExecutionStatus {
  switch (waitKind) {
    case undefined:
    case "manual_action":
    case "external_dependency":
    case "capability_unavailable":
      return "blocked";
    case "user_input":
      return "waiting_for_user";
    case "approval":
    case "review":
    case "replan_required":
      return "waiting_for_approval";
  }
}

export function executionStatusFromGraphOutcome(outcome: GraphDispatchOutcome): PlanExecutionStatus {
  switch (outcome.status) {
    case "running":
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
    case "failed":
    case "completed":
    case "cancelled":
      return outcome.status;
    case "unsupported":
      return "blocked";
  }
}

export function pauseReasonFromExecutionStatus(
  status: PlanExecutionStatus,
  waitKind?: WaitKind,
): ExecutionPauseReason | null {
  if (waitKind) return waitKind;
  switch (status) {
    case "waiting_for_user":
      return "user_input";
    case "waiting_for_approval":
      return "approval";
    case "blocked":
      return "manual_action";
    case "failed":
      return "manual_action";
    case "completed":
    case "running":
    case "cancelled":
    case "started":
    case "no_plan":
      return null;
  }
}

export function taskStatusForExecutionStatus(status: PlanExecutionStatus): TaskStatus {
  switch (status) {
    case "started":
    case "no_plan":
    case "running":
      return TaskStatus.Running;
    case "waiting_for_user":
      return TaskStatus.WaitingForInput;
    case "waiting_for_approval":
      return TaskStatus.WaitingForApproval;
    case "blocked":
      return TaskStatus.Blocked;
    case "failed":
      return TaskStatus.Failed;
    case "completed":
      return TaskStatus.Completed;
    case "cancelled":
      return TaskStatus.Cancelled;
  }
}

export function planRunStatusForExecutionStatus(status: PlanExecutionStatus): PlanRun["status"] {
  switch (status) {
    case "started":
    case "no_plan":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
      return "paused";
  }
}

export function graphStatusForExecutionStatus(status: PlanExecutionStatus): PlanGraph["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "running":
    case "started":
    case "no_plan":
      return "active";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
    case "failed":
      return "paused";
  }
}

export function executionTransition(input: {
  status: PlanExecutionStatus;
  pauseReason?: WaitKind | null;
  message?: string;
  nodeId?: string | null;
}): ExecutionTransition {
  const pauseReason = pauseReasonFromExecutionStatus(input.status, input.pauseReason ?? undefined);
  return {
    status: input.status,
    taskStatus: taskStatusForExecutionStatus(input.status),
    sessionStatus: sessionStatusForExecutionStatus(input.status),
    planRunStatus: planRunStatusForExecutionStatus(input.status),
    graphStatus: graphStatusForExecutionStatus(input.status),
    pauseReason,
    blockReason: blockReasonForExecutionStatus({
      status: input.status,
      pauseReason,
      message: input.message,
      nodeId: input.nodeId,
    }),
  };
}

function sessionStatusForExecutionStatus(
  status: PlanExecutionStatus,
): ExecutionTransition["sessionStatus"] {
  switch (status) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Abandoned";
    case "running":
    case "started":
    case "no_plan":
      return "Active";
    case "waiting_for_user":
    case "waiting_for_approval":
    case "blocked":
    case "failed":
      return "Paused";
  }
}

function blockReasonForExecutionStatus(input: {
  status: PlanExecutionStatus;
  pauseReason: ExecutionPauseReason | null;
  message?: string;
  nodeId?: string | null;
}): ExecutionTransition["blockReason"] {
  switch (input.status) {
    case "waiting_for_user":
      return planNodeBlockReason("human_input_required", input, "Provide input");
    case "waiting_for_approval":
      return planNodeBlockReason(approvalBlockType(input.pauseReason), input, "Review step output");
    case "blocked":
      return planNodeBlockReason(blockedBlockType(input.pauseReason), input, "Resolve blocked node");
    case "failed":
      return planNodeBlockReason("node_failed", input, "Retry or replan failed node");
    case "running":
    case "completed":
    case "cancelled":
    case "started":
    case "no_plan":
      return Prisma.DbNull;
  }
}

function planNodeBlockReason(
  blockType: string,
  input: {
    message?: string;
    nodeId?: string | null;
  },
  fallbackAction: string,
) {
  return {
    blockType,
    scope: "plan_node",
    actionRequired: input.message ?? fallbackAction,
    nodeId: input.nodeId ?? undefined,
  };
}

function approvalBlockType(pauseReason: ExecutionPauseReason | null) {
  return pauseReason === "replan_required" ? "replan_required" : "approval_required";
}

function blockedBlockType(pauseReason: ExecutionPauseReason | null) {
  switch (pauseReason) {
    case "capability_unavailable":
      return "capability_unavailable";
    case "external_dependency":
      return "external_dependency";
    case "manual_action":
    case null:
    case "user_input":
    case "approval":
    case "review":
    case "replan_required":
      return "node_blocked";
  }
}

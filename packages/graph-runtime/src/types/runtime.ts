// Result + runtime-status types are owned by @chrona/contracts/ai.
export type {
  NodeResult,
  NodeResultEvidence,
  NodeActionForm,
  NodeActionFormField,
  ArtifactRef,
  CheckpointResponse,
  NodeRuntimeStatus,
  NodeRuntimeState,
  PlanRunStatus,
  RuntimeProgressStatus,
} from "@chrona/contracts/ai";

import type { WaitKind, NodeRuntimeStatus } from "@chrona/contracts/ai";

// ─── graph-runtime-local named extractions (contracts inlines these in NodeResult) ───

export interface NodeResultReview {
  required: boolean;
  status: "pending" | "accepted" | "rejected" | "request_changes";
  feedback?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface NodeResultSelectedBranch {
  label: string;
  nextNodeId: string;
  source: "user" | "ai" | "system" | "default";
}

// ─── graph-runtime progress-status derivation (logic, not types) ───

export function runtimeProgressStatusForWaitKind(
  waitKind: WaitKind | undefined,
): "waiting_for_user" | "waiting_for_approval" | "blocked" {
  switch (waitKind) {
    case "user_input":
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
}): "running" | "waiting_for_user" | "waiting_for_approval" | "blocked" | "failed" | "completed" | "cancelled" {
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

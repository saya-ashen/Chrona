import type { TaskPlanNode, TaskPlanGraph, PlanUpdatePatch } from "@/modules/ai/types";
import type { NodeExecutionResult } from "./node-executor";

export type PlanDriftDecision =
  | { needsReplan: false }
  | {
      needsReplan: true;
      risk: "low" | "medium" | "high";
      reason: string;
      proposedPatch: PlanUpdatePatch;
      requiresUserConfirmation: boolean;
    };

export type ReplanDetectorInput = {
  node: TaskPlanNode;
  nodeResult: NodeExecutionResult;
  plan: TaskPlanGraph;
  mainSessionSummary: string | null;
};

export function detectPlanDrift(input: ReplanDetectorInput): PlanDriftDecision {
  const { node, nodeResult, plan } = input;

  if (nodeResult.status === "replan_required") {
    return {
      needsReplan: true,
      risk: "medium",
      reason: nodeResult.reason,
      proposedPatch: nodeResult.proposedPatch ?? {
        operation: "update_node",
        nodePatches: [
          { nodeId: node.id, patch: { requiresUserConfirmation: true } },
        ],
      },
      requiresUserConfirmation: true,
    };
  }

  const doneNodes = plan.nodes.filter(
    (n) => n.status === "done" || n.status === "skipped",
  ).length;

  if (
    doneNodes > 0 &&
    nodeResult.status === "done" &&
    plan.nodes.every((n) => n.status === "done" || n.status === "skipped")
  ) {
    return { needsReplan: false };
  }

  if (nodeResult.status === "blocked" || nodeResult.status === "failed") {
    return {
      needsReplan: true,
      risk: "high",
      reason: nodeResult.status === "failed" ? nodeResult.error : nodeResult.reason,
      proposedPatch: {
        operation: "update_node",
        nodePatches: [
          {
            nodeId: node.id,
            patch: {
              requiresHumanInput: true,
              status: "waiting_for_user",
            },
          },
        ],
      },
      requiresUserConfirmation: true,
    };
  }

  if (nodeResult.status === "waiting_for_user") {
    return { needsReplan: false };
  }

  return { needsReplan: false };
}

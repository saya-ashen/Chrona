import type { EffectivePlanNode, EffectivePlanGraph, PlanPatch } from "@chrona/contracts/ai";
import type { NodeExecutionResult } from "./node-executor";

type PlanDriftDecision = {
  needsReplan: boolean;
  reason: string;
  risk: "low" | "medium" | "high";
  requiresUserConfirmation: boolean;
  proposedPatch?: PlanPatch;
};

export function detectPlanDrift(input: {
  node: EffectivePlanNode;
  nodeResult: NodeExecutionResult;
  plan: EffectivePlanGraph;
}): PlanDriftDecision {
  const { node, nodeResult, plan } = input;

  switch (nodeResult.status) {
    case "replan_required":
      return {
        needsReplan: true,
        reason: nodeResult.reason,
        risk: "medium",
        requiresUserConfirmation: true,
        proposedPatch: nodeResult.proposedPatch,
      };

    case "failed":
      return {
        needsReplan: true,
        reason: `Node ${node.id} (${node.title}) failed. Replan required.`,
        risk: "high",
        requiresUserConfirmation: true,
      };

    case "blocked": {
      const completedCount = plan.nodes.filter(
        (n) => n.status === "completed" || n.status === "skipped",
      ).length;

      if (completedCount === 0) {
        return {
          needsReplan: true,
          reason: `First node ${node.id} (${node.title}) is blocked — plan cannot start. Replan required.`,
          risk: "high",
          requiresUserConfirmation: true,
        };
      }

      return {
        needsReplan: false,
        reason: `Node ${node.id} (${node.title}) blocked: ${nodeResult.reason}`,
        risk: "low",
        requiresUserConfirmation: false,
      };
    }

    default:
      return {
        needsReplan: false,
        reason: "No drift detected",
        risk: "low",
        requiresUserConfirmation: false,
      };
  }
}

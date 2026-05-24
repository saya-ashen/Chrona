import type { EffectivePlanGraph, EffectivePlanNode } from "../types";
import type { GraphNodeExecutionResult } from "./types";

export function explainNodeExecutionBlock(input: {
  node: EffectivePlanNode;
  allowWaitingInputResume?: boolean;
}): string | null {
  if (!input.node.reachable) {
    return `Node ${input.node.id} is not reachable in the effective graph`;
  }

  if (input.node.ready) {
    return null;
  }

  if (
    input.allowWaitingInputResume &&
    input.node.status === "waiting_for_user" &&
    input.node.dependenciesSatisfied
  ) {
    return null;
  }

  if (!input.node.dependenciesSatisfied) {
    return `Node ${input.node.id} has unsatisfied dependencies: ${input.node.dependencies.join(", ")}`;
  }

  return `Node ${input.node.id} is ${input.node.status}, not executable`;
}

export function findEffectiveGraphInvariantViolation(effective: EffectivePlanGraph): string | null {
  for (const node of effective.nodes) {
    if (node.status !== "completed") continue;

    if (node.type === "condition" && node.dependents.length > 0 && !node.result?.selectedBranch) {
      return `Condition node ${node.id} completed without a structured selectedBranch`;
    }

    const unmetDependency = node.dependencies.find((dependencyId) => {
      const dependency = effective.nodes.find((candidate) => candidate.id === dependencyId);
      return !dependency || !["completed", "skipped", "invalidated"].includes(dependency.status);
    });
    if (unmetDependency) {
      return `Completed node ${node.id} has unfinished dependency ${unmetDependency}`;
    }
  }

  return null;
}

export function normalizeNodeResult(input: {
  node: Pick<EffectivePlanNode, "id" | "type">;
  result: GraphNodeExecutionResult;
}): GraphNodeExecutionResult {
  if (
    input.node.type === "condition" &&
    input.result.status === "done" &&
    !input.result.selectedBranch
  ) {
    return {
      status: "blocked",
      reason: `Condition node ${input.node.id} completed without a structured selectedBranch`,
      evidence: input.result.evidence,
    };
  }

  return input.result;
}

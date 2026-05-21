import type {
  ConditionConfig,
  EffectivePlanGraph,
  EffectivePlanNode,
} from "./types";
import type { GraphNodeExecutionResult } from "./execution/types";

function normalizeBranchToken(value: string): string {
  return value.trim().toLowerCase();
}

function pickUserBranch(input: string | undefined, config: ConditionConfig) {
  if (!input) return null;

  const normalizedInput = normalizeBranchToken(input);
  const direct = config.branches.find((branch) => {
    const label = normalizeBranchToken(branch.label);
    const nextNodeId = normalizeBranchToken(branch.nextNodeId);
    return (
      normalizedInput === label ||
      normalizedInput === nextNodeId ||
      normalizedInput.includes(label)
    );
  });

  if (direct) {
    return {
      label: direct.label,
      nextNodeId: direct.nextNodeId,
      source: "user" as const,
    };
  }

  if (
    config.defaultNextNodeId &&
    ["default", "fallback", "other"].some((token) => normalizedInput.includes(token))
  ) {
    return {
      label: "default",
      nextNodeId: config.defaultNextNodeId,
      source: "default" as const,
    };
  }

  return null;
}

function buildUserPrompt(node: EffectivePlanNode, config: ConditionConfig): string {
  const branchOptions = config.branches.map((branch) => branch.label).join(" / ");
  return `Choose branch for condition node "${node.title}": ${branchOptions}${config.defaultNextNodeId ? " / default" : ""}`;
}

function toEffectiveBranchTarget(plan: EffectivePlanGraph, nextNodeId: string): string {
  return plan.nodes.find((node) => node.localId === nextNodeId)?.id ?? nextNodeId;
}

export function executeBuiltinGraphNode(input: {
  node: EffectivePlanNode;
  plan: EffectivePlanGraph;
  userInput?: string;
}): GraphNodeExecutionResult | null {
  if (input.node.status === "completed" || input.node.status === "skipped") {
    const nodeConfig = input.node.config as Record<string, unknown>;
    const summary =
      typeof nodeConfig.completionSummary === "string"
        ? nodeConfig.completionSummary
        : `Node ${input.node.id} was already completed`;
    return { status: "done", summary, evidence: {} };
  }

  if (input.node.type !== "condition") {
    return null;
  }

  const config = input.node.config as ConditionConfig;
  if (config.evaluationBy === "user") {
    const selectedBranch = pickUserBranch(input.userInput, config);
    if (!selectedBranch) {
      return {
        status: "waiting_for_user",
        prompt: buildUserPrompt(input.node, config),
        reason: `Condition node ${input.node.id} requires an explicit branch selection`,
        evidence: {},
      };
    }

    return {
      status: "done",
      summary: `Condition resolved to branch: ${selectedBranch.label}`,
      evidence: {},
      selectedBranch: {
        ...selectedBranch,
        nextNodeId: toEffectiveBranchTarget(input.plan, selectedBranch.nextNodeId),
      },
    };
  }

  return {
    status: "blocked",
    reason: `Condition node ${input.node.id} uses ${config.evaluationBy} evaluation, but no evaluator was provided.`,
    evidence: {},
  };
}

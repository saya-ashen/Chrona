import type { ConditionConfig, EffectivePlanNode } from "@chrona/contracts/ai";
import type { NodeExecutor, NodeExecutorInput, NodeExecutionResult } from "./types";
import { evaluateConditionNodeCapability } from "../runtime/node-ai-capabilities";
import type { AiRuntimeInvoker } from "../ai-runtime-invoker";

function normalizeBranchToken(value: string) {
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
    ["default", "fallback", "其他", "默认"].some((token) =>
      normalizedInput.includes(token),
    )
  ) {
    return {
      label: "default",
      nextNodeId: config.defaultNextNodeId,
      source: "default" as const,
    };
  }

  return null;
}

function buildUserPrompt(node: EffectivePlanNode, config: ConditionConfig) {
  const branchOptions = config.branches.map((branch) => branch.label).join(" / ");
  return `Select a branch for condition node "${node.title}": ${branchOptions}${config.defaultNextNodeId ? " / default" : ""}`;
}

function toCompiledBranchTarget(input: NodeExecutorInput, nextNodeId: string) {
  return input.plan.nodes.find((node) => node.localId === nextNodeId)?.id ?? nextNodeId;
}

export class ConditionNodeExecutor implements NodeExecutor {
  readonly nodeType = "condition" as const;

  constructor(private readonly aiRuntimeInvoker: AiRuntimeInvoker) {}

  canExecute(node: EffectivePlanNode): boolean {
    return node.type === "condition";
  }

  async execute(input: NodeExecutorInput): Promise<NodeExecutionResult> {
    const config = input.node.config as ConditionConfig;

    if (config.evaluationBy === "user") {
      const selectedBranch = pickUserBranch(input.userInput, config);
      if (!selectedBranch) {
        return {
          status: "waiting_for_user",
          prompt: buildUserPrompt(input.node, config),
          reason: `Condition node ${input.node.id} requires an explicit branch selection`,
          evidence: { sessionId: input.mainSession.id },
        };
      }

      return {
        status: "done",
        summary: `Condition resolved to branch: ${selectedBranch.label}`,
        evidence: { sessionId: input.mainSession.id },
        selectedBranch: {
          ...selectedBranch,
          nextNodeId: toCompiledBranchTarget(input, selectedBranch.nextNodeId),
        },
      };
    }

    if (config.evaluationBy === "ai") {
      return evaluateConditionNodeCapability({
        ...input,
        aiRuntimeInvoker: this.aiRuntimeInvoker,
      });
    }

    throw new Error(`Unsupported condition evaluator: ${config.evaluationBy satisfies never}`);
  }
}

import type { EffectivePlanGraph, EffectivePlanNode, NodeResult } from "@chrona/contracts/ai";
import { branchBindingForRef } from "./node-runtime-refs";
import type { AdvanceRuntimeCommand } from "../types";
import { ENGINE_ERROR_CODES, EngineError } from "../../../errors";

type CompleteManualNodeCommand = Extract<
  AdvanceRuntimeCommand,
  { type: "complete_manual_node" }
>;

export function summaryForTerminalCommand(input: {
  command: CompleteManualNodeCommand;
  node: EffectivePlanNode;
}): string {
  const summary = input.command.summary?.trim();
  if (summary) return summary;
  const resultSummary = input.node.result?.outputSummary?.trim();
  if (resultSummary) return resultSummary;
  if (input.command.terminalKind === "checkpoint") {
    return `Checkpoint ${input.command.decision ?? "completed"}: ${input.node.title}`;
  }
  return `Manual node ${input.node.id} completed`;
}

export function selectedBranchForTerminalCommand(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  command: CompleteManualNodeCommand;
}): NodeResult["selectedBranch"] | undefined {
  if (input.command.terminalKind !== "condition") {
    return input.command.selectedBranch;
  }
  if (!input.command.branchRef) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "condition branchRef is required");
  }
  const binding = branchBindingForRef({
    plan: input.plan,
    node: input.node,
    branchRef: input.command.branchRef,
  });
  return {
    ref: binding.ref,
    key: binding.branchKey,
    label: binding.label,
    nextNodeId: binding.nextNodeId!,
    resolvedNextNodeId: binding.nextNodeId,
    resolvedNextNodeLayerId: binding.nextNodeLayerId ?? null,
    refVersion: binding.version,
    source: "ai",
  };
}

export function validateTerminalCommand(input: {
  plan: EffectivePlanGraph;
  node: EffectivePlanNode;
  command: CompleteManualNodeCommand;
}) {
  const kind = input.command.terminalKind;
  if (!kind) return;
  if (input.node.type !== kind) {
    throw new EngineError(
      ENGINE_ERROR_CODES.INVALID_TASK_STATE,
      `chrona ${kind} terminal tool cannot complete current ${input.node.type} node`,
    );
  }
  if (kind === "condition") {
    selectedBranchForTerminalCommand(input);
  }
  if (kind === "checkpoint") {
    const decision = input.command.decision;
    if (!decision)
      throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "checkpoint decision is required");
    if (decision === "needs_input" && !input.command.feedback && !input.command.prompt) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "checkpoint needs_input requires feedback or prompt",
      );
    }
    if (decision === "completed" && !input.command.summary) {
      throw new EngineError(
        ENGINE_ERROR_CODES.VALIDATION_FAILED,
        "checkpoint completed requires summary",
      );
    }
  }
}

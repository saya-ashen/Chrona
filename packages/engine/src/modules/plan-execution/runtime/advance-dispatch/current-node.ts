import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import { currentNodeFromState } from "../../projection/execution-graph-selectors";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";
import type { ExternalResultAdvanceCommand } from "./types";

export function resolveCurrentCommandNode(input: {
  command: ExternalResultAdvanceCommand;
  effective: EffectivePlanGraph;
  executionSession: ExecutionSessionRow;
}): EffectivePlanNode {
  const node = currentNodeFromState({
    effective: input.effective,
    executionSession: input.executionSession,
    nodeId: input.command.nodeId,
  });
  if (!node) {
    throw new Error("No current execution node found for node result tool.");
  }
  return node;
}

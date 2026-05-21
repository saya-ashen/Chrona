import type { GraphExecutionState, GraphRuntimeCommand } from "@chrona/graph-runtime";
import type { EffectivePlanGraph, NodeResult } from "@chrona/contracts/ai";
import type {
  AdvanceRuntimeCommand,
  EngineRuntimeContext,
  OrchestratorTrigger,
} from "../../types";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";

export type BuildAdvanceDispatchCommandInput = {
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
  executionSession: ExecutionSessionRow;
  forcedNodeId?: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  forcedReplaceStatus?: NonNullable<NodeResult["status"]>;
  command?: AdvanceRuntimeCommand;
};

export type AdvanceDispatchResolution =
  | { type: "already_completed"; effective: EffectivePlanGraph }
  | { type: "dispatch"; command: GraphRuntimeCommand };

export type ExternalResultAdvanceCommand = Extract<
  AdvanceRuntimeCommand,
  { type: "complete_manual_node" | "block_current_node" | "fail_current_node" }
>;

export type AdvanceDispatchCommandBase = {
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
};

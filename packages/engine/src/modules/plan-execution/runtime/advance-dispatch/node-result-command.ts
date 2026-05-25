import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type { EffectivePlanGraph, EffectivePlanNode } from "@chrona/contracts/ai";
import type { GraphExecutionState, GraphRuntimeCommand } from "@chrona/graph-runtime";
import type { EngineRuntimeContext, OrchestratorTrigger } from "../../types";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";
import {
  selectedBranchForTerminalCommand,
  summaryForTerminalCommand,
  validateTerminalCommand,
} from "../terminal-command";
import { resolveCurrentCommandNode } from "./current-node";
import { isTerminalStatus } from "./terminal-state";
import type { AdvanceDispatchResolution, NodeResultAdvanceCommand } from "./types";

function nodeResultCommand(input: {
  command: NodeResultAdvanceCommand;
  commandNode: EffectivePlanNode;
  effective: EffectivePlanGraph;
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
}): GraphRuntimeCommand {
  const base = {
    type: "submit_node_result" as const,
    state: input.state,
    trigger: input.trigger,
    context: input.context,
  };

  switch (input.command.type) {
    case "complete_manual_node":
      return {
        ...base,
        nodeResult: {
          nodeId: input.commandNode.id,
          status: "done",
          summary: summaryForTerminalCommand({
            command: input.command,
            node: input.commandNode,
          }),
          output: input.command.output,
          selectedBranch: selectedBranchForTerminalCommand({
            plan: input.effective,
            node: input.commandNode,
            command: input.command,
          }),
        },
        continueExecution: input.command.continueExecution,
      };
    case "block_current_node":
      return {
        ...base,
        nodeResult: {
          nodeId: input.commandNode.id,
          status: "blocked",
          reason: input.command.reason,
          actionForm: input.command.actionForm,
        },
      };
    case "fail_current_node":
      return {
        ...base,
        nodeResult: {
          nodeId: input.commandNode.id,
          status: "failed",
          error: input.command.error,
        },
      };
  }
}

export function nodeResultCommandResolution(input: {
  command: NodeResultAdvanceCommand;
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
  executionSession: ExecutionSessionRow;
}): AdvanceDispatchResolution {
  const effective = resolveEffectivePlanGraph(input.state);
  if (isTerminalStatus(effective)) {
    return { type: "already_completed", effective };
  }

  const commandNode = resolveCurrentCommandNode({
    command: input.command,
    effective,
    executionSession: input.executionSession,
  });

  if (input.command.type === "complete_manual_node") {
    validateTerminalCommand({ plan: effective, node: commandNode, command: input.command });
  }

  return {
    type: "dispatch",
    command: nodeResultCommand({
      command: input.command,
      commandNode,
      effective,
      state: input.state,
      trigger: input.trigger,
      context: input.context,
    }),
  };
}

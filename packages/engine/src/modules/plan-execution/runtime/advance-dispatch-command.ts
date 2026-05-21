import { resolveEffectivePlanGraph } from "@chrona/graph-runtime";
import type {
  GraphExecutionState,
  GraphRuntimeCommand,
} from "@chrona/graph-runtime";
import type {
  EffectivePlanGraph,
  EffectivePlanNode,
  NodeResult,
} from "@chrona/contracts/ai";
import type {
  AdvanceRuntimeCommand,
  EngineRuntimeContext,
  OrchestratorTrigger,
} from "../types";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";
import { executionStatusFromEffectiveGraph } from "../execution-state-machine";
import { currentNodeFromState } from "../projection/execution-graph-selectors";
import {
  selectedBranchForTerminalCommand,
  summaryForTerminalCommand,
  validateTerminalCommand,
} from "./terminal-command";

type BuildAdvanceDispatchCommandInput = {
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

type AdvanceDispatchResolution =
  | { type: "already_completed"; effective: EffectivePlanGraph }
  | { type: "dispatch"; command: GraphRuntimeCommand };

type ExternalResultAdvanceCommand = Extract<
  AdvanceRuntimeCommand,
  { type: "complete_manual_node" | "block_current_node" | "fail_current_node" }
>;

function commandNeedsCurrentNode(command: AdvanceRuntimeCommand) {
  return (
    command.type === "complete_manual_node" ||
    command.type === "block_current_node" ||
    command.type === "fail_current_node"
  );
}

function isExternalResultCommand(
  command: AdvanceRuntimeCommand,
): command is ExternalResultAdvanceCommand {
  return commandNeedsCurrentNode(command);
}

function isTerminalStatus(effective: EffectivePlanGraph) {
  return executionStatusFromEffectiveGraph(effective) === "completed";
}

function resolveCurrentCommandNode(input: {
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

function externalResultCommand(input: {
  command: ExternalResultAdvanceCommand;
  commandNode: EffectivePlanNode;
  effective: EffectivePlanGraph;
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
}): GraphRuntimeCommand {
  const base = {
    type: "sync_external_result" as const,
    state: input.state,
    trigger: input.trigger,
    context: input.context,
  };

  switch (input.command.type) {
    case "complete_manual_node":
      return {
        ...base,
        externalResult: {
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
        externalResult: {
          nodeId: input.commandNode.id,
          status: "blocked",
          reason: input.command.reason,
          actionForm: input.command.actionForm,
        },
      };
    case "fail_current_node":
      return {
        ...base,
        externalResult: {
          nodeId: input.commandNode.id,
          status: "failed",
          error: input.command.error,
        },
      };
  }
}

function externalCommandResolution(input: {
  command: ExternalResultAdvanceCommand;
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
    command: externalResultCommand({
      command: input.command,
      commandNode,
      effective,
      state: input.state,
      trigger: input.trigger,
      context: input.context,
    }),
  };
}

function nonExternalCommand(input: {
  command: AdvanceRuntimeCommand;
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
}): GraphRuntimeCommand {
  const { command, state, trigger, context } = input;

  switch (command.type) {
    case "resume_with_input":
      return {
        type: "resume_with_input",
        state,
        trigger,
        context,
        input: {
          nodeId: command.nodeId,
          value: command.value,
          fields: command.fields,
          replaceStatus: command.replaceStatus,
        },
      };
    case "resume_after_unblock":
      return {
        type: "resume_after_unblock",
        state,
        trigger,
        context,
        nodeId: command.nodeId,
      };
    case "resume_with_approval":
      return {
        type: "resume_with_approval",
        state,
        trigger,
        context,
        input: {
          nodeId: command.nodeId,
          approved: command.approved,
          feedback: command.feedback,
          userInput: command.feedback,
        },
      };
    case "complete_manual_node":
    case "block_current_node":
    case "fail_current_node":
      throw new Error("External result commands must be resolved before dispatch.");
    case "retry_node":
      return {
        type: "retry_node",
        state,
        trigger,
        context,
        nodeId: command.nodeId,
        reason: command.reason,
        userInput: command.reason,
      };
    case "cancel_session":
      return {
        type: "cancel_session",
        state,
        trigger,
        context,
        reason: command.reason,
      };
    case "start":
      return { type: "start", state, trigger, context };
  }
}

function explicitCommand(input: {
  command: AdvanceRuntimeCommand;
  state: GraphExecutionState;
  trigger: OrchestratorTrigger;
  context: EngineRuntimeContext;
  executionSession: ExecutionSessionRow;
}): AdvanceDispatchResolution {
  if (isExternalResultCommand(input.command)) {
    return externalCommandResolution({
      command: input.command,
      state: input.state,
      trigger: input.trigger,
      context: input.context,
      executionSession: input.executionSession,
    });
  }

  return {
    type: "dispatch",
    command: nonExternalCommand(input),
  };
}

export function buildAdvanceDispatchCommand(
  input: BuildAdvanceDispatchCommandInput,
): AdvanceDispatchResolution {
  if (input.command) {
    return explicitCommand({
      command: input.command,
      state: input.state,
      trigger: input.trigger,
      context: input.context,
      executionSession: input.executionSession,
    });
  }

  if (input.forcedNodeId && input.userInput) {
    return {
      type: "dispatch",
      command: {
        type: "resume_with_input",
        state: input.state,
        trigger: input.trigger,
        context: input.context,
        input: {
          nodeId: input.forcedNodeId,
          value: input.userInput,
          fields: input.inputFields ?? {},
          replaceStatus: input.forcedReplaceStatus ?? "obsolete",
        },
      },
    };
  }

  if (input.forcedNodeId) {
    return {
      type: "dispatch",
      command: {
        type: "resume_after_unblock",
        state: input.state,
        trigger: input.trigger,
        context: input.context,
        nodeId: input.forcedNodeId,
      },
    };
  }

  return {
    type: "dispatch",
    command: {
      type: "start",
      state: input.state,
      trigger: input.trigger,
      context: input.context,
    },
  };
}

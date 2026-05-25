import type { GraphRuntimeCommand } from "@chrona/graph-runtime";
import type { AdvanceRuntimeCommand } from "../../types";
import type { AdvanceDispatchCommandBase } from "./types";

export function nonNodeResultCommand(
  input: AdvanceDispatchCommandBase & { command: AdvanceRuntimeCommand },
): GraphRuntimeCommand {
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
      throw new Error("Node result commands must be resolved before dispatch.");
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
    case "pause_session":
      return {
        type: "pause_session",
        state,
        trigger,
        context,
        reason: command.reason,
      };
    case "start":
      return { type: "start", state, trigger, context };
  }
}

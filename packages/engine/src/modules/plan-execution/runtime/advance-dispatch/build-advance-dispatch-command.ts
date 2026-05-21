import { explicitCommand } from "./explicit-command";
import type { AdvanceDispatchResolution, BuildAdvanceDispatchCommandInput } from "./types";

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

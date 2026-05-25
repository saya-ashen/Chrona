import type { AdvanceRuntimeCommand } from "../../types";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";
import { isNodeResultCommand } from "./command-kind";
import { nodeResultCommandResolution } from "./node-result-command";
import { nonNodeResultCommand } from "./non-node-result-command";
import type { AdvanceDispatchCommandBase, AdvanceDispatchResolution } from "./types";

export function explicitCommand(
  input: AdvanceDispatchCommandBase & {
    command: AdvanceRuntimeCommand;
    executionSession: ExecutionSessionRow;
  },
): AdvanceDispatchResolution {
  if (isNodeResultCommand(input.command)) {
    return nodeResultCommandResolution({
      command: input.command,
      state: input.state,
      trigger: input.trigger,
      context: input.context,
      executionSession: input.executionSession,
    });
  }

  return {
    type: "dispatch",
    command: nonNodeResultCommand(input),
  };
}

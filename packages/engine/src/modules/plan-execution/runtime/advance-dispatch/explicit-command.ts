import type { AdvanceRuntimeCommand } from "../../types";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";
import { isExternalResultCommand } from "./command-kind";
import { externalCommandResolution } from "./external-result-command";
import { nonExternalCommand } from "./non-external-command";
import type { AdvanceDispatchCommandBase, AdvanceDispatchResolution } from "./types";

export function explicitCommand(
  input: AdvanceDispatchCommandBase & {
    command: AdvanceRuntimeCommand;
    executionSession: ExecutionSessionRow;
  },
): AdvanceDispatchResolution {
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

import type { AdvanceRuntimeCommand } from "../../types";
import type { ExternalResultAdvanceCommand } from "./types";

export function commandNeedsCurrentNode(command: AdvanceRuntimeCommand) {
  return (
    command.type === "complete_manual_node" ||
    command.type === "block_current_node" ||
    command.type === "fail_current_node"
  );
}

export function isExternalResultCommand(
  command: AdvanceRuntimeCommand,
): command is ExternalResultAdvanceCommand {
  return commandNeedsCurrentNode(command);
}

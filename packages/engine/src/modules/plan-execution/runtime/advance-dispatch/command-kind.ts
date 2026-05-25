import type { AdvanceRuntimeCommand } from "../../types";
import type { NodeResultAdvanceCommand } from "./types";

export function commandNeedsCurrentNode(command: AdvanceRuntimeCommand) {
  return (
    command.type === "complete_manual_node" ||
    command.type === "block_current_node" ||
    command.type === "fail_current_node"
  );
}

export function isNodeResultCommand(
  command: AdvanceRuntimeCommand,
): command is NodeResultAdvanceCommand {
  return commandNeedsCurrentNode(command);
}

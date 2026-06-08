import type { ChronaToolOperation } from "@chrona/contracts";

export function requireTaskId(input: ChronaToolOperation["input"]) {
  if (!input.taskId) {
    throw new Error("taskId is required");
  }
  return input.taskId;
}

export function requireWorkspaceId(input: ChronaToolOperation["input"]) {
  if (!input.workspaceId) {
    throw new Error("workspaceId is required");
  }
  return input.workspaceId;
}

import type { ChronaToolOperation } from "@chrona/contracts";
import { ENGINE_ERROR_CODES, EngineError } from "../../errors";

export function requireTaskId(input: ChronaToolOperation["input"]) {
  if (!input.taskId) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "taskId is required");
  }
  return input.taskId;
}

export function requireWorkspaceId(input: ChronaToolOperation["input"]) {
  if (!input.workspaceId) {
    throw new EngineError(ENGINE_ERROR_CODES.VALIDATION_FAILED, "workspaceId is required");
  }
  return input.workspaceId;
}

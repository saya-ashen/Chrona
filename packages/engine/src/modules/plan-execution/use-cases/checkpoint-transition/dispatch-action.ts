import type { ExecutionActionWithContinuation } from "../../types";
import { observerCallbacks } from "./observer";
import type {
  CheckpointTransitionHandlerInput,
  DispatchExecutionAction,
} from "./types";

export async function dispatchCheckpointAction(input: {
  taskId: string;
  executionAction: ExecutionActionWithContinuation;
  dispatchExecutionAction: DispatchExecutionAction;
} & Omit<CheckpointTransitionHandlerInput, "action">) {
  return input.dispatchExecutionAction({
    taskId: input.taskId,
    action: input.executionAction,
    ...observerCallbacks(input),
  });
}

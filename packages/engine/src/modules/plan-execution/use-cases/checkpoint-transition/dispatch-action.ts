import type { ExecutionActionWithContinuation, ExecutionDispatchContext } from "../../types";
import { checkpointPayloadFields } from "../../execution-actions";
import { observerCallbacks } from "./observer";
import type {
  CheckpointTransitionHandlerInput,
  DispatchExecutionAction,
} from "./types";

export async function dispatchCheckpointAction(input: {
  taskId: string;
  executionAction: ExecutionActionWithContinuation;
  commandContext?: ExecutionDispatchContext;
  dispatchExecutionAction: DispatchExecutionAction;
} & Omit<CheckpointTransitionHandlerInput, "action">) {
  const action = input.executionAction.action === "resume_with_input"
    ? {
        ...input.executionAction,
        inputFields: checkpointPayloadFields(input.payload),
      }
    : input.executionAction;

  return input.dispatchExecutionAction({
    taskId: input.taskId,
    action,
    commandContext: input.commandContext,
    ...observerCallbacks(input),
  });
}

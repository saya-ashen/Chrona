import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { dispatchCheckpointAction } from "./dispatch-action";
import { checkpointNodeId } from "./node";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

export async function failTaskTransition(
  input: CheckpointTransitionInput<"fail_task">,
): Promise<SubmitCheckpointActionResult> {
  const execution = await dispatchCheckpointAction({
    ...input,
    executionAction: {
      action: "fail_current_node",
      sessionId: input.executionSession.id,
      nodeId: checkpointNodeId({
        checkpoint: input.checkpoint,
        reason: "Checkpoint failure requires a node.",
      }),
      error: input.transition.reason,
    },
    dispatchExecutionAction: input.dispatchExecutionAction,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

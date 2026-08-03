import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { dispatchCheckpointAction } from "./dispatch-action";
import { checkpointNodeId } from "./node";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

export async function rerunCurrentNodeTransition(
  input: CheckpointTransitionInput<"rerun_current_node">,
): Promise<SubmitCheckpointActionResult> {
  const execution = await dispatchCheckpointAction({
    ...input,
    executionAction: {
      action: "retry_node",
      nodeId: checkpointNodeId({
        checkpoint: input.checkpoint,
        reason: "Checkpoint retry requires a node.",
      }),
      prompt: input.payloadText,
      idempotencyKey: input.idempotencyKey,
    },
    commandContext: { sessionId: input.executionSession.id },
    dispatchExecutionAction: input.dispatchExecutionAction,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

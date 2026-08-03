import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { dispatchCheckpointAction } from "./dispatch-action";
import { checkpointNodeId } from "./node";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

export async function markCurrentCompletedTransition(
  input: CheckpointTransitionInput<"mark_current_completed">,
): Promise<SubmitCheckpointActionResult> {
  const execution = await dispatchCheckpointAction({
    ...input,
    executionAction: {
      action: "complete_manual_node",
      nodeId: checkpointNodeId({
        checkpoint: input.checkpoint,
        reason: "Checkpoint completion requires a node.",
      }),
      summary: input.payloadText ?? "Checkpoint marked completed",
      output: input.transition.output,
      continueExecution: true,
      idempotencyKey: input.idempotencyKey,
    },
    commandContext: { sessionId: input.executionSession.id },
    dispatchExecutionAction: input.dispatchExecutionAction,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

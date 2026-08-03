import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { dispatchCheckpointAction } from "./dispatch-action";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

export async function cancelSessionTransition(
  input: CheckpointTransitionInput<"cancel_session">,
): Promise<SubmitCheckpointActionResult> {
  const execution = await dispatchCheckpointAction({
    ...input,
    executionAction: {
      action: "cancel_session",
      reason: input.transition.reason,
      idempotencyKey: input.idempotencyKey,
    },
    commandContext: { sessionId: input.executionSession.id },
    dispatchExecutionAction: input.dispatchExecutionAction,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

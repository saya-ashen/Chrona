import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

export async function continueNextReadyTransition(
  input: CheckpointTransitionInput<"continue_next_ready">,
): Promise<SubmitCheckpointActionResult> {
  const execution = await input.resumePlanExecutionWithApproval({
    taskId: input.taskId,
    sessionId: input.executionSession.id,
    nodeId: input.checkpoint.nodeId ?? undefined,
    approved: true,
    feedback: input.payloadText,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

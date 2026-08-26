import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { dispatchCheckpointAction } from "./dispatch-action";
import { checkpointNodeId } from "./node";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";
import { validateManualCompletionSubmission } from "../../manual-completion-submission";

export async function markCurrentCompletedTransition(
  input: CheckpointTransitionInput<"mark_current_completed">,
): Promise<SubmitCheckpointActionResult> {
  const manualSubmission = input.checkpoint.kind === "manual_completion"
    ? input.checkpoint.form
      ? validateManualCompletionSubmission({ form: input.checkpoint.form, payload: input.payload })
      : (() => { throw new Error("Manual completion checkpoint has no validated form."); })()
    : null;
  const execution = await dispatchCheckpointAction({
    ...input,
    executionAction: {
      action: "complete_manual_node",
      nodeId: checkpointNodeId({
        checkpoint: input.checkpoint,
        reason: "Checkpoint completion requires a node.",
      }),
      formRevision: input.checkpoint.form?.revision,
      summary: manualSubmission?.summary ?? input.payloadText ?? "Checkpoint marked completed",
      inputFields: manualSubmission?.inputFields,
      output: manualSubmission ? { inputFields: manualSubmission.inputFields } : input.transition.output,
      continueExecution: true,
      idempotencyKey: input.idempotencyKey,
    },
    commandContext: { sessionId: input.executionSession.id },
    dispatchExecutionAction: input.dispatchExecutionAction,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

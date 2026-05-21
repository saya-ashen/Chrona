import { checkpointPayloadText } from "../../execution-actions";
import type { SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { cancelSessionTransition } from "./cancel-session";
import { continueNextReadyTransition } from "./continue-next-ready";
import { failTaskTransition } from "./fail-task";
import { markCurrentCompletedTransition } from "./mark-current-completed";
import { rerunCurrentNodeTransition } from "./rerun-current-node";
import { resumeCurrentNodeTransition } from "./resume-current-node";
import { stayPausedTransition } from "./stay-paused";
import type { ResolveCheckpointTransitionInput } from "./types";

export async function resolveCheckpointTransition(
  input: ResolveCheckpointTransitionInput,
): Promise<SubmitCheckpointActionResult> {
  const handlerInput = {
    ...input,
    payloadText: checkpointPayloadText(input.payload),
  };

  switch (input.transition.type) {
    case "continue_next_ready":
      return continueNextReadyTransition({ ...handlerInput, transition: input.transition });
    case "resume_current_node":
      return resumeCurrentNodeTransition({ ...handlerInput, transition: input.transition });
    case "rerun_current_node":
      return rerunCurrentNodeTransition({ ...handlerInput, transition: input.transition });
    case "mark_current_completed":
      return markCurrentCompletedTransition({ ...handlerInput, transition: input.transition });
    case "fail_task":
      return failTaskTransition({ ...handlerInput, transition: input.transition });
    case "cancel_session":
      return cancelSessionTransition({ ...handlerInput, transition: input.transition });
    case "stay_paused":
      return stayPausedTransition({ ...handlerInput, transition: input.transition });
    case "apply_graph_mutation":
    case "mark_current_skipped":
      throw new Error(`Checkpoint transition ${input.transition.type} is not implemented.`);
  }
}

import type { CheckpointInputFields, CheckpointFieldValue, SubmitCheckpointActionResult } from "@chrona/contracts/ai";
import { checkpointPayloadFields } from "../../execution-actions";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

function formatFieldValue(value: CheckpointFieldValue): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatInputFields(inputFields: CheckpointInputFields) {
  return Object.entries(inputFields)
    .map(([key, value]) => `${key}: ${formatFieldValue(value)}`)
    .join("\n");
}

export async function resumeCurrentNodeTransition(
  input: CheckpointTransitionInput<"resume_current_node">,
): Promise<SubmitCheckpointActionResult> {
  const fields = checkpointPayloadFields(input.payload);
  const execution = await input.continuePlanExecution({
    taskId: input.taskId,
    reason:
      input.checkpoint.kind === "user_input"
        ? "checkpoint_input"
        : "checkpoint_resume",
    userInput: Object.keys(fields).length ? formatInputFields(fields) : input.payloadText,
    inputFields: fields,
    sessionId: input.executionSession.id,
    nodeId: input.checkpoint.nodeId ?? undefined,
    ...observerCallbacks(input),
  });
  return { transition: input.transition, execution };
}

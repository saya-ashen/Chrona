import type { SubmitCheckpointActionResult, WaitKind } from "@chrona/contracts/ai";
import { appendMainSessionEvent } from "../../plan-state-store";
import { buildExecutionResponse } from "../../projection/execution-response";
import { observerCallbacks } from "./observer";
import type { CheckpointTransitionInput } from "./types";

export async function stayPausedTransition(
  input: CheckpointTransitionInput<"stay_paused">,
): Promise<SubmitCheckpointActionResult> {
  if (input.action === "reject_result" && input.checkpoint.nodeId) {
    const execution = await input.resumePlanExecutionWithApproval({
      taskId: input.taskId,
      sessionId: input.executionSession.id,
      nodeId: input.checkpoint.nodeId,
      approved: false,
      feedback: input.transition.reason,
      ...observerCallbacks(input),
    });
    return { transition: input.transition, execution };
  }

  await appendMainSessionEvent({
    taskId: input.taskId,
    planId: input.planId,
    sessionId: input.mainSession.id,
    eventType: "user_input_received",
    payload: {
      reason: `checkpoint:${input.action}`,
      feedback: input.transition.reason,
      nodeId: input.checkpoint.nodeId,
    },
  });

  return {
    transition: input.transition,
    execution: buildExecutionResponse({
      taskId: input.taskId,
      planId: input.planId,
      mainSessionId: input.mainSession.id,
      executionSessionId: input.executionSession.id,
      planRunId: input.planId,
      status: input.status,
      effective: input.effective,
      currentNodeId: input.currentNodeId,
      executedNodeIds: input.effective.completedNodeIds,
      message: input.transition.reason,
      waitKind: input.executionSession.pauseReason as WaitKind | undefined,
    }),
  };
}

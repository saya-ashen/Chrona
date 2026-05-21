import { db } from "@/lib/db";
import { rebuildTaskProjection } from "@/modules/projections/rebuild-task-projection";
import type { NodeAttempt } from "@chrona/contracts/ai";
import { executionStatusFromGraphOutcome, executionTransition } from "../../execution-state-machine";
import { setExecutionSessionState } from "../../persistence/execution-session-store";
import { waitKindFromOutcome } from "../../runtime/runtime-outcome";
import type { SyncedRuntimeOutcome } from "./types";

export async function pauseSyncedExecution(input: {
  taskId: string;
  attempt: NodeAttempt;
  executionSessionId?: string;
  outcome: SyncedRuntimeOutcome;
}) {
  const executionStatus = executionStatusFromGraphOutcome(input.outcome);
  if (executionStatus === "completed" || executionStatus === "running") return;

  const currentNodeId = input.outcome.currentNodeId ?? input.attempt.nodeId;
  const transition = executionTransition({
    status: executionStatus,
    pauseReason: waitKindFromOutcome(input.outcome),
    message: input.outcome.message,
    nodeId: currentNodeId,
  });

  if (input.executionSessionId) {
    await setExecutionSessionState({
      sessionId: input.executionSessionId,
      status: transition.sessionStatus,
      currentNodeId,
      pauseReason: transition.pauseReason,
      completedNodeIds: input.outcome.effective.completedNodeIds,
    });
  }

  await db.task.update({
    where: { id: input.taskId },
    data: {
      status: transition.taskStatus,
      blockReason: transition.blockReason,
    },
  });
  await rebuildTaskProjection(input.taskId);
}

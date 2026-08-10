import type {
  EffectivePlanGraph,
  ExecutionCheckpoint,
  PlanExecutionResult,
  PlanExecutionStatus,
  WaitKind,
  PlanOutputState,
} from "@chrona/contracts/ai";
import { buildCommandCenterCheckpointSpec } from "@chrona/ui-protocol";
import { deriveExecutionCheckpoint } from "../execution-checkpoint";

export function buildExecutionResponse(input: {
  taskId: string;
  planId: string;
  mainSessionId: string;
  executionSessionId?: string;
  planRunId?: string;
  status: PlanExecutionStatus;
  effective: EffectivePlanGraph;
  currentNodeId: string | null;
  executedNodeIds: string[];
  message: string;
  waitKind?: WaitKind;
  checkpoint?: ExecutionCheckpoint | null;
  planOutput?: Pick<PlanOutputState, "manifest" | "finalizedResult" | "finalization" | "revision" | "updatedAt" | "updatedByNodeId">;
}): PlanExecutionResult {
  const publicMessage = input.status === "failed"
    ? "Plan execution failed."
    : input.status === "cancelled"
      ? "Plan execution cancelled."
      : input.message;
  const checkpoint = input.checkpoint ?? (
    input.planRunId || input.effective.waitingNodeIds.length > 0
      ? deriveExecutionCheckpoint({
          taskId: input.taskId,
          sessionId: input.executionSessionId ?? input.mainSessionId,
          planRunId: input.planRunId ?? input.planId,
          status: input.status,
          effective: input.effective,
          currentNodeId: input.currentNodeId,
          waitKind: input.waitKind,
          message: publicMessage,
        })
      : null
  );
  const currentOperationSpec = checkpoint
    ? buildCommandCenterCheckpointSpec({ checkpoint })
    : null;

  return {
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    status: input.status,
    executionSessionId: input.executionSessionId ?? null,
    planRunId: input.planRunId ?? null,
    currentNodeId: input.currentNodeId,
    executedNodeIds: input.executedNodeIds,
    waitingNodeIds: input.effective.waitingNodeIds,
    blockedNodeIds: input.effective.blockedNodeIds,
    checkpoint,
    planOutput: input.planOutput,
    ui: { currentOperationSpec },
    message: publicMessage,
  };
}

import type {
  EffectivePlanGraph,
  ExecutionCheckpoint,
  PlanExecutionResult,
  PlanExecutionStatus,
  WaitKind,
} from "@chrona/contracts/ai";
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
  errorDetails?: unknown;
  waitKind?: WaitKind;
  checkpoint?: ExecutionCheckpoint | null;
}): PlanExecutionResult {
  const checkpoint = input.checkpoint ?? (
    input.executionSessionId && input.planRunId
      ? deriveExecutionCheckpoint({
          taskId: input.taskId,
          sessionId: input.executionSessionId,
          planRunId: input.planRunId,
          status: input.status,
          effective: input.effective,
          currentNodeId: input.currentNodeId,
          waitKind: input.waitKind,
          message: input.message,
        })
      : null
  );

  return {
    taskId: input.taskId,
    planId: input.planId,
    mainSessionId: input.mainSessionId,
    status: input.status,
    currentNodeId: input.currentNodeId,
    executedNodeIds: input.executedNodeIds,
    waitingNodeIds: input.effective.waitingNodeIds,
    blockedNodeIds: input.effective.blockedNodeIds,
    checkpoint,
    message: input.message,
    ...(input.errorDetails ? { errorDetails: input.errorDetails } : {}),
  };
}

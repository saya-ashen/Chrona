import { appendMainSessionEvent } from "../plan-state-store";
import { buildExecutionResponse } from "../projection/execution-response";
import { checkpointPayloadFields, checkpointPayloadText } from "../execution-actions";
import type {
  EffectivePlanGraph,
  ExecutionCheckpoint,
  PlanExecutionResult,
  SubmitCheckpointActionResult,
  WaitKind,
} from "@chrona/contracts/ai";
import type {
  ExecutionActionWithContinuation,
  PlanExecutionObserver,
} from "../types";
import type { ExecutionSessionRow } from "../persistence/execution-session-store";

type CheckpointTransition = SubmitCheckpointActionResult["transition"];

type ContinuePlanExecution = (input: {
  taskId: string;
  reason: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  sessionId?: string;
  nodeId?: string;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

type ResumeWithApproval = (input: {
  taskId: string;
  sessionId?: string;
  nodeId?: string;
  approved: boolean;
  feedback?: string;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

type DispatchExecutionAction = (input: {
  taskId: string;
  action: ExecutionActionWithContinuation;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

function formatInputFields(inputFields: Record<string, string>) {
  return Object.entries(inputFields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function observerCallbacks(input: PlanExecutionObserver): PlanExecutionObserver {
  return {
    onGraphEvent: input.onGraphEvent,
    onRuntimeEvent: input.onRuntimeEvent,
    onStateChange: input.onStateChange,
  };
}

function checkpointNodeId(input: {
  checkpoint: ExecutionCheckpoint;
  reason: string;
}) {
  if (!input.checkpoint.nodeId) throw new Error(input.reason);
  return input.checkpoint.nodeId;
}

async function dispatchCheckpointAction(input: {
  taskId: string;
  executionSession: ExecutionSessionRow;
  checkpoint: ExecutionCheckpoint;
  action: ExecutionActionWithContinuation;
  dispatchExecutionAction: DispatchExecutionAction;
} & PlanExecutionObserver) {
  return input.dispatchExecutionAction({
    taskId: input.taskId,
    action: input.action,
    ...observerCallbacks(input),
  });
}

export async function resolveCheckpointTransition(input: {
  taskId: string;
  planId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
  executionSession: ExecutionSessionRow;
  checkpoint: ExecutionCheckpoint;
  transition: CheckpointTransition;
  action: string;
  payload: unknown;
  status: PlanExecutionResult["status"];
  effective: EffectivePlanGraph;
  currentNodeId: string | null;
  continuePlanExecution: ContinuePlanExecution;
  resumePlanExecutionWithApproval: ResumeWithApproval;
  dispatchExecutionAction: DispatchExecutionAction;
} & PlanExecutionObserver): Promise<SubmitCheckpointActionResult> {
  const payloadText = checkpointPayloadText(input.payload);

  switch (input.transition.type) {
    case "continue_next_ready": {
      const execution = await input.resumePlanExecutionWithApproval({
        taskId: input.taskId,
        sessionId: input.executionSession.id,
        nodeId: input.checkpoint.nodeId ?? undefined,
        approved: true,
        feedback: payloadText,
        ...observerCallbacks(input),
      });
      return { transition: input.transition, execution };
    }
    case "resume_current_node": {
      const fields = checkpointPayloadFields(input.payload);
      const execution = await input.continuePlanExecution({
        taskId: input.taskId,
        reason: input.checkpoint.kind === "user_input" ? "checkpoint_input" : "checkpoint_resume",
        userInput: Object.keys(fields).length ? formatInputFields(fields) : payloadText,
        inputFields: fields,
        sessionId: input.executionSession.id,
        nodeId: input.checkpoint.nodeId ?? undefined,
        ...observerCallbacks(input),
      });
      return { transition: input.transition, execution };
    }
    case "rerun_current_node": {
      const execution = await dispatchCheckpointAction({
        taskId: input.taskId,
        executionSession: input.executionSession,
        checkpoint: input.checkpoint,
        action: {
          action: "retry_node",
          sessionId: input.executionSession.id,
          nodeId: checkpointNodeId({
            checkpoint: input.checkpoint,
            reason: "Checkpoint retry requires a node.",
          }),
          prompt: payloadText,
        },
        dispatchExecutionAction: input.dispatchExecutionAction,
        ...observerCallbacks(input),
      });
      return { transition: input.transition, execution };
    }
    case "mark_current_completed": {
      const execution = await dispatchCheckpointAction({
        taskId: input.taskId,
        executionSession: input.executionSession,
        checkpoint: input.checkpoint,
        action: {
          action: "complete_manual_node",
          sessionId: input.executionSession.id,
          nodeId: checkpointNodeId({
            checkpoint: input.checkpoint,
            reason: "Checkpoint completion requires a node.",
          }),
          summary: payloadText ?? "Checkpoint marked completed",
          output: input.transition.output,
          continueExecution: true,
        },
        dispatchExecutionAction: input.dispatchExecutionAction,
        ...observerCallbacks(input),
      });
      return { transition: input.transition, execution };
    }
    case "fail_task": {
      const execution = await dispatchCheckpointAction({
        taskId: input.taskId,
        executionSession: input.executionSession,
        checkpoint: input.checkpoint,
        action: {
          action: "fail_current_node",
          sessionId: input.executionSession.id,
          nodeId: checkpointNodeId({
            checkpoint: input.checkpoint,
            reason: "Checkpoint failure requires a node.",
          }),
          error: input.transition.reason,
        },
        dispatchExecutionAction: input.dispatchExecutionAction,
        ...observerCallbacks(input),
      });
      return { transition: input.transition, execution };
    }
    case "cancel_session": {
      const execution = await dispatchCheckpointAction({
        taskId: input.taskId,
        executionSession: input.executionSession,
        checkpoint: input.checkpoint,
        action: {
          action: "cancel_session",
          sessionId: input.executionSession.id,
          reason: input.transition.reason,
        },
        dispatchExecutionAction: input.dispatchExecutionAction,
        ...observerCallbacks(input),
      });
      return { transition: input.transition, execution };
    }
    case "stay_paused": {
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
    case "apply_graph_mutation":
    case "mark_current_skipped":
      throw new Error(`Checkpoint transition ${input.transition.type} is not implemented.`);
  }
}

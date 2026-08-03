import type {
  CheckpointInputFields,
  EffectivePlanGraph,
  ExecutionCheckpoint,
  PlanExecutionResult,
  SubmitCheckpointActionResult,
} from "@chrona/contracts/ai";
import type {
  ExecutionActionWithContinuation,
  ExecutionDispatchContext,
  PlanExecutionObserver,
} from "../../types";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";

export type CheckpointTransition = SubmitCheckpointActionResult["transition"];

export type ContinuePlanExecution = (input: {
  taskId: string;
  reason: string;
  userInput?: string;
  inputFields?: CheckpointInputFields;
  sessionId?: string;
  nodeId?: string;
  workBlockId?: string | null;
  idempotencyKey?: string;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

export type ResumeWithApproval = (input: {
  taskId: string;
  sessionId?: string;
  nodeId?: string;
  approved: boolean;
  feedback?: string;
  workBlockId?: string | null;
  idempotencyKey?: string;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

export type DispatchExecutionAction = (input: {
  taskId: string;
  action: ExecutionActionWithContinuation;
  commandContext?: ExecutionDispatchContext;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

export type ResolveCheckpointTransitionInput = {
  taskId: string;
  planId: string;
  planRunId: string;
  mainSession: { id: string; taskId: string; sessionKey: string };
  executionSession: ExecutionSessionRow;
  idempotencyKey?: string;
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
} & PlanExecutionObserver;

export type CheckpointTransitionHandlerInput = ResolveCheckpointTransitionInput & {
  payloadText: string | undefined;
};

export type CheckpointTransitionInput<TransitionType extends CheckpointTransition["type"]> =
  Omit<CheckpointTransitionHandlerInput, "transition"> & {
    transition: Extract<CheckpointTransition, { type: TransitionType }>;
  };

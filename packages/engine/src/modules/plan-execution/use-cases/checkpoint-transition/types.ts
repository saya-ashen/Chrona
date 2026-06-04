import type {
  EffectivePlanGraph,
  ExecutionCheckpoint,
  PlanExecutionResult,
  SubmitCheckpointActionResult,
} from "@chrona/contracts/ai";
import type {
  ExecutionActionWithContinuation,
  PlanExecutionObserver,
} from "../../types";
import type { ExecutionSessionRow } from "../../persistence/execution-session-store";

export type CheckpointTransition = SubmitCheckpointActionResult["transition"];

export type ContinuePlanExecution = (input: {
  taskId: string;
  reason: string;
  userInput?: string;
  inputFields?: Record<string, string>;
  sessionId?: string;
  nodeId?: string;
  workBlockId?: string | null;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

export type ResumeWithApproval = (input: {
  taskId: string;
  sessionId?: string;
  nodeId?: string;
  approved: boolean;
  feedback?: string;
  workBlockId?: string | null;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

export type DispatchExecutionAction = (input: {
  taskId: string;
  action: ExecutionActionWithContinuation;
} & PlanExecutionObserver) => Promise<PlanExecutionResult>;

export type ResolveCheckpointTransitionInput = {
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
} & PlanExecutionObserver;

export type CheckpointTransitionHandlerInput = ResolveCheckpointTransitionInput & {
  payloadText: string | undefined;
};

export type CheckpointTransitionInput<TransitionType extends CheckpointTransition["type"]> =
  Omit<CheckpointTransitionHandlerInput, "transition"> & {
    transition: Extract<CheckpointTransition, { type: TransitionType }>;
  };

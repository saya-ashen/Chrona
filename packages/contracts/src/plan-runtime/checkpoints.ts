import type { CheckpointActionKind, PlanExecutionResult } from "./_leaf";

export type {
  CheckpointResponse,
  CheckpointFieldValue,
  CheckpointInputFields,
  ExecutionCheckpointKind,
  CheckpointActionKind,
  CheckpointFormField,
  CheckpointForm,
  CheckpointAction,
  ExecutionCheckpoint,
} from "./_leaf";

export type PostCheckpointTransition =
  | { type: "continue_next_ready" }
  | { type: "resume_current_node"; input?: unknown }
  | { type: "rerun_current_node"; input?: unknown }
  | { type: "stay_paused"; reason: string }
  | { type: "apply_graph_mutation"; mutationId: string }
  | { type: "mark_current_completed"; output?: unknown }
  | { type: "mark_current_skipped"; reason?: string }
  | { type: "fail_task"; reason: string }
  | { type: "cancel_session"; reason?: string };

export type SubmitCheckpointActionInput = {
  checkpointId: string;
  action: CheckpointActionKind;
  payload?: unknown;
  workBlockId?: string | null;
  idempotencyKey?: string;
};

export type SubmitCheckpointActionResult = {
  transition: PostCheckpointTransition;
  execution: PlanExecutionResult;
};

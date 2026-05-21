import type { PlanExecutionResult } from "./execution-state";
import type { NodeActionFormField } from "./node";

export interface CheckpointResponse {
  id: string;
  planRunId: string;
  nodeId: string;
  response: unknown;
  submittedAt: string;
}

export type CheckpointFormField = NodeActionFormField & {
  value?: string;
};

export interface CheckpointForm {
  instructions: string;
  submitLabel?: string;
  inputFields: CheckpointFormField[];
}

export type ExecutionCheckpointKind =
  | "user_input"
  | "approval"
  | "review"
  | "replan_required"
  | "blocked"
  | "failed"
  | "manual_recovery"
  | "external_dependency";

export type CheckpointActionKind =
  | "submit_input"
  | "approve_result"
  | "reject_result"
  | "request_changes"
  | "request_replan"
  | "accept_replan"
  | "reject_replan"
  | "retry_node"
  | "resume_after_unblock"
  | "mark_node_completed"
  | "mark_node_skipped"
  | "cancel_session"
  | "fail_task";

export interface CheckpointAction {
  id: CheckpointActionKind;
  label: string;
  style: "primary" | "secondary" | "danger";
  requiresPayload?: boolean;
  payloadSchema?: unknown;
}

export interface ExecutionCheckpoint {
  id: string;
  taskId: string;
  sessionId: string;
  planRunId: string;
  nodeId: string | null;
  kind: ExecutionCheckpointKind;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  form?: CheckpointForm;
  availableActions: CheckpointAction[];
  createdAt: string;
}

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
  idempotencyKey?: string;
};

export type SubmitCheckpointActionResult = {
  transition: PostCheckpointTransition;
  execution: PlanExecutionResult;
};

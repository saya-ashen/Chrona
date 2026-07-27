import type {
  CheckpointActionKind,
  CheckpointInputFields,
  ExecutionCheckpoint,
  PostCheckpointTransition,
} from "@chrona/contracts/ai";

const TRANSITION_BY_ACTION: Record<
  CheckpointActionKind,
  (payload: unknown) => PostCheckpointTransition
> = {
  submit_input: (payload) => ({ type: "resume_current_node", input: payload }),
  approve_result: () => ({ type: "continue_next_ready" }),
  reject_result: (payload) => ({ type: "stay_paused", reason: payloadText(payload) ?? "Result rejected" }),
  request_changes: (payload) => ({ type: "rerun_current_node", input: payload }),
  request_replan: (payload) => ({ type: "stay_paused", reason: payloadText(payload) ?? "Replan requested" }),
  accept_replan: (payload) => ({ type: "apply_graph_mutation", mutationId: payloadMutationId(payload) }),
  reject_replan: (payload) => ({ type: "stay_paused", reason: payloadText(payload) ?? "Replan rejected" }),
  retry_node: (payload) => ({ type: "rerun_current_node", input: payload }),
  resume_after_unblock: (payload) => ({ type: "rerun_current_node", input: payload }),
  mark_node_completed: (payload) => ({ type: "mark_current_completed", output: payload }),
  mark_node_skipped: (payload) => ({ type: "mark_current_skipped", reason: payloadText(payload) }),
  cancel_session: (payload) => ({ type: "cancel_session", reason: payloadText(payload) }),
  fail_task: (payload) => ({ type: "fail_task", reason: payloadText(payload) ?? "Task failed from checkpoint." }),
};

export function resolveCheckpointAction(input: {
  checkpoint: ExecutionCheckpoint;
  action: CheckpointActionKind;
  payload?: unknown;
}): PostCheckpointTransition {
  if (!input.checkpoint.availableActions.some((action) => action.id === input.action)) {
    throw new Error(`Checkpoint action ${input.action} is not available.`);
  }

  return TRANSITION_BY_ACTION[input.action](input.payload);
}

export function checkpointPayloadFields(payload: unknown): CheckpointInputFields {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const source = typeof record.inputFields === "object" && record.inputFields
    ? record.inputFields as Record<string, unknown>
    : record;
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) =>
      typeof value === "string" ||
      typeof value === "boolean" ||
      (Array.isArray(value) && value.every((entry) => typeof entry === "string")),
    ),
  ) as CheckpointInputFields;
}

export function checkpointPayloadText(payload: unknown) {
  return payloadText(payload);
}

function payloadText(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload.trim() || undefined;
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ["reason", "feedback", "note", "summary", "prompt", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function payloadMutationId(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>).mutationId;
    if (typeof value === "string" && value.trim()) return value;
  }
  throw new Error("accept_replan requires payload.mutationId");
}

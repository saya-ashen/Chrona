import type {
  CheckpointAction,
  CheckpointForm,
  EffectivePlanGraph,
  EffectivePlanNode,
  ExecutionCheckpoint,
  ExecutionCheckpointKind,
  PlanExecutionStatus,
  WaitKind,
} from "@chrona/contracts/ai";

type DeriveExecutionCheckpointInput = {
  taskId: string;
  sessionId: string;
  planRunId: string;
  status: PlanExecutionStatus;
  effective: EffectivePlanGraph;
  currentNodeId: string | null;
  waitKind?: WaitKind;
  message: string;
  now?: Date;
};

const ACTIONS = {
  submitInput: {
    id: "submit_input",
    label: "Submit input",
    style: "primary",
    requiresPayload: true,
  },
  approveResult: {
    id: "approve_result",
    label: "Approve result",
    style: "primary",
  },
  rejectResult: {
    id: "reject_result",
    label: "Reject result",
    style: "secondary",
    requiresPayload: true,
  },
  requestChanges: {
    id: "request_changes",
    label: "Request changes",
    style: "secondary",
    requiresPayload: true,
  },
  requestReplan: {
    id: "request_replan",
    label: "Request replan",
    style: "secondary",
    requiresPayload: true,
  },
  retryNode: {
    id: "retry_node",
    label: "Retry node",
    style: "primary",
    requiresPayload: false,
  },
  resumeAfterUnblock: {
    id: "resume_after_unblock",
    label: "Resume after fix",
    style: "primary",
    requiresPayload: true,
  },
  markNodeCompleted: {
    id: "mark_node_completed",
    label: "Mark completed",
    style: "secondary",
    requiresPayload: true,
  },
  cancelSession: {
    id: "cancel_session",
    label: "Cancel execution",
    style: "danger",
    requiresPayload: false,
  },
  failTask: {
    id: "fail_task",
    label: "Fail task",
    style: "danger",
    requiresPayload: true,
  },
} satisfies Record<string, CheckpointAction>;

export function deriveExecutionCheckpoint(
  input: DeriveExecutionCheckpointInput,
): ExecutionCheckpoint | null {
  if (!isCheckpointStatus(input.status)) return null;

  const node = findCheckpointNode(input);
  const kind = checkpointKind({ status: input.status, waitKind: input.waitKind, node });

  return {
    id: checkpointId({ planRunId: input.planRunId, nodeId: node?.id ?? null, kind }),
    taskId: input.taskId,
    sessionId: input.sessionId,
    planRunId: input.planRunId,
    nodeId: node?.id ?? null,
    kind,
    title: checkpointTitle(kind, node),
    message: checkpointMessage({ message: input.message, kind, node }),
    severity: checkpointSeverity(kind),
    ...(checkpointForm(node) ? { form: checkpointForm(node) } : {}),
    availableActions: checkpointActions(kind),
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function checkpointId(input: {
  planRunId: string;
  nodeId: string | null;
  kind: ExecutionCheckpointKind;
}) {
  return `${input.planRunId}:${input.nodeId ?? "execution"}:${input.kind}`;
}

function isCheckpointStatus(status: PlanExecutionStatus) {
  return status === "waiting_for_user" ||
    status === "waiting_for_approval" ||
    status === "blocked" ||
    status === "failed";
}

function findCheckpointNode(input: DeriveExecutionCheckpointInput) {
  return (
    (input.currentNodeId
      ? input.effective.nodes.find((node) => node.id === input.currentNodeId)
      : null) ??
    input.effective.nodes.find((node) => node.status === "waiting_for_user") ??
    input.effective.nodes.find((node) => node.status === "waiting_for_approval") ??
    input.effective.nodes.find((node) => node.status === "failed") ??
    input.effective.nodes.find((node) => node.status === "blocked") ??
    null
  );
}

function checkpointKind(input: {
  status: PlanExecutionStatus;
  waitKind?: WaitKind;
  node: EffectivePlanNode | null;
}): ExecutionCheckpointKind {
  const waitKind = input.waitKind ?? input.node?.waitKind ?? input.node?.result?.waitKind;
  if (input.status === "waiting_for_user") return "user_input";
  if (input.status === "waiting_for_approval") return approvalCheckpointKind(waitKind);
  if (input.status === "failed") return "failed";
  return blockedCheckpointKind(waitKind);
}

function approvalCheckpointKind(waitKind: WaitKind | undefined): ExecutionCheckpointKind {
  if (waitKind === "replan_required") return "replan_required";
  if (waitKind === "review") return "review";
  return "approval";
}

function blockedCheckpointKind(waitKind: WaitKind | undefined): ExecutionCheckpointKind {
  if (waitKind === "external_dependency") return "external_dependency";
  if (waitKind === "manual_action") return "manual_recovery";
  return "blocked";
}

function checkpointTitle(kind: ExecutionCheckpointKind, node: EffectivePlanNode | null) {
  const nodeTitle = node?.title ?? "Execution";
  switch (kind) {
    case "user_input":
      return `Input required: ${nodeTitle}`;
    case "approval":
      return `Approval required: ${nodeTitle}`;
    case "review":
      return `Review required: ${nodeTitle}`;
    case "replan_required":
      return `Replan required: ${nodeTitle}`;
    case "blocked":
      return `Blocked: ${nodeTitle}`;
    case "failed":
      return `Failed: ${nodeTitle}`;
    case "manual_recovery":
      return `Manual recovery required: ${nodeTitle}`;
    case "external_dependency":
      return `External dependency required: ${nodeTitle}`;
  }
}

function checkpointMessage(input: {
  message: string;
  kind: ExecutionCheckpointKind;
  node: EffectivePlanNode | null;
}) {
  if (input.message.trim()) return input.message;
  const result = input.node?.result;
  if (result?.error) return result.error;
  if (input.node?.blockedReason) return input.node.blockedReason;
  return input.kind === "failed"
    ? "Node failed. Choose a recovery action."
    : "Execution paused. Choose the next action.";
}

function checkpointSeverity(kind: ExecutionCheckpointKind): ExecutionCheckpoint["severity"] {
  if (kind === "failed") return "error";
  if (kind === "blocked" || kind === "manual_recovery" || kind === "external_dependency") {
    return "warning";
  }
  return "info";
}

function checkpointForm(node: EffectivePlanNode | null): CheckpointForm | undefined {
  const actionForm = node?.result?.actionForm;
  if (!actionForm) return undefined;
  return {
    instructions: actionForm.instructions,
    ...(actionForm.submitLabel ? { submitLabel: actionForm.submitLabel } : {}),
    inputFields: actionForm.inputFields,
  };
}

function checkpointActions(kind: ExecutionCheckpointKind): CheckpointAction[] {
  switch (kind) {
    case "user_input":
      return [ACTIONS.submitInput, ACTIONS.cancelSession];
    case "approval":
    case "review":
      return [
        ACTIONS.approveResult,
        ACTIONS.rejectResult,
        ACTIONS.requestChanges,
        ACTIONS.requestReplan,
        ACTIONS.cancelSession,
      ];
    case "replan_required":
      return [ACTIONS.requestReplan, ACTIONS.retryNode, ACTIONS.cancelSession];
    case "blocked":
    case "manual_recovery":
    case "external_dependency":
      return [
        ACTIONS.resumeAfterUnblock,
        ACTIONS.retryNode,
        ACTIONS.requestReplan,
        ACTIONS.markNodeCompleted,
        ACTIONS.cancelSession,
      ];
    case "failed":
      return [ACTIONS.retryNode, ACTIONS.requestReplan, ACTIONS.failTask, ACTIONS.cancelSession];
  }
}

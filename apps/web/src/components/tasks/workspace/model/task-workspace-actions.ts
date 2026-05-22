import type { CheckpointActionKind, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import type {
  PlanNodeAction,
  PlanNodeDataModel,
  PlanNodeField,
} from "@/components/tasks/plan/task-plan-graph/types";
import type { ExecutionOverviewTone, WorkspaceStateTreatment } from "./task-workspace-types";

type WorkspacePresentationInput = {
  currentNode: PlanNodeDataModel | null;
  hasPlan: boolean;
  allNodesDone: boolean;
  isBlocked?: boolean;
  isStale?: boolean;
  isPermissionLimited?: boolean;
  permissionSummary?: string;
  blockActionRequired?: string | null;
};

const workspaceStateToneByLabel = {
  "Sync stale": "warning",
  "View only": "warning",
  "No plan yet": "neutral",
  Blocked: "critical",
  Degraded: "critical",
  "Review required": "warning",
  "Approval required": "warning",
  Running: "info",
  Completed: "success",
  Idle: "neutral",
} satisfies Record<string, ExecutionOverviewTone>;

export function buildWorkspaceStateTreatment(input: WorkspacePresentationInput): WorkspaceStateTreatment {
  if (input.isStale) {
    return {
      label: "Sync stale",
      tone: workspaceStateToneByLabel["Sync stale"],
      guidance: "Refresh before acting on execution results.",
    };
  }

  if (input.isPermissionLimited) {
    return {
      label: "View only",
      tone: workspaceStateToneByLabel["View only"],
      guidance: input.permissionSummary ?? "You can view this task, but cannot run it.",
    };
  }

  if (!input.hasPlan) {
    return {
      label: "No plan yet",
      tone: workspaceStateToneByLabel["No plan yet"],
      guidance: "Generate and accept a plan to unlock execution controls.",
    };
  }

  if (input.allNodesDone) {
    return {
      label: "Completed",
      tone: workspaceStateToneByLabel.Completed,
      guidance: "Review the latest result and artifacts before closing the task.",
    };
  }

  if (input.currentNode?.status === "degraded") {
    return {
      label: "Degraded",
      tone: workspaceStateToneByLabel.Degraded,
      guidance: input.currentNode.nextAction ?? "Retry sync or repair this node before continuing execution.",
    };
  }

  if (input.currentNode?.status === "blocked" || input.currentNode?.status === "failed") {
    return {
      label: "Blocked",
      tone: workspaceStateToneByLabel.Blocked,
      guidance: input.blockActionRequired ?? input.currentNode?.nextAction ?? "Resolve the blocker before continuing execution.",
    };
  }

  if (input.currentNode?.status === "waiting_for_approval") {
    return {
      label: "Approval required",
      tone: workspaceStateToneByLabel["Approval required"],
      guidance: input.currentNode.nextAction ?? "Approve or reject the current node to continue.",
    };
  }

  if (input.currentNode?.status === "waiting_for_user" || input.currentNode?.requiresHumanInput === true) {
    return {
      label: "Review required",
      tone: workspaceStateToneByLabel["Review required"],
      guidance: input.currentNode.nextAction ?? "Complete the current node action to continue.",
    };
  }

  if (input.currentNode?.status === "active" || input.currentNode?.status === "in_progress") {
    return {
      label: "Running",
      tone: workspaceStateToneByLabel.Running,
      guidance: input.currentNode.nextAction ?? "Monitor current execution progress.",
    };
  }

  if (input.isBlocked) {
    return {
      label: "Blocked",
      tone: workspaceStateToneByLabel.Blocked,
      guidance: input.blockActionRequired ?? "Resolve the blocker before continuing execution.",
    };
  }

  return {
    label: "Idle",
    tone: workspaceStateToneByLabel.Idle,
    guidance: input.currentNode?.nextAction ?? "Select a plan node or start execution when ready.",
  };
}

export function buildDefaultWorkspaceActionFields(fields: PlanNodeField[]) {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.value || ""]),
  );
}

export function pickDefaultWorkspaceAction(node: PlanNodeDataModel) {
  return (
    node.availableActions?.find((action) => action.emphasis === "primary")
      ?.id ??
    node.availableActions?.[0]?.id ??
    null
  );
}

export function getMissingWorkspaceActionFields(fields: PlanNodeField[], values: Record<string, string>) {
  return fields.filter((field) => field.required && !values[field.key]?.trim());
}

export function getWorkspaceActionDisabledReason(input: {
  fields: PlanNodeField[];
  values: Record<string, string>;
  isDispatching: boolean;
  baseReason?: string;
}) {
  if (input.isDispatching) return "Action is already being sent.";
  if (input.baseReason) return input.baseReason;

  const missingFields = getMissingWorkspaceActionFields(input.fields, input.values);
  if (missingFields.length > 0) {
    return `Complete required field${missingFields.length === 1 ? "" : "s"}: ${missingFields.map((field) => field.label).join(", ")}.`;
  }

  return null;
}

export function buildWorkspaceCheckpointActionInput(input: {
  node: PlanNodeDataModel;
  selectedAction: PlanNodeAction | null;
  fields: PlanNodeField[];
  values: Record<string, string>;
}): SubmitCheckpointActionInput {
  const checkpointId = input.selectedAction?.checkpointId ?? input.node.checkpoint?.id;
  const checkpointAction = input.selectedAction?.checkpointAction ?? actionKindForNode(input.node, input.selectedAction);

  if (!checkpointId) {
    throw new Error("No active checkpoint is available for this node.");
  }

  if (!checkpointAction) {
    throw new Error("No checkpoint action is available for this node.");
  }

  const inputText = buildWorkspaceInputText(input.fields, input.values);
  const inputFields = buildWorkspaceInputFields(input.fields, input.values);

  return {
    checkpointId,
    action: checkpointAction,
    payload: buildCheckpointActionPayload({
      action: checkpointAction,
      inputFields,
      inputText,
      fallbackText: input.node.nextAction ?? undefined,
    }),
  };
}

function actionKindForNode(node: PlanNodeDataModel, selectedAction: PlanNodeAction | null): CheckpointActionKind | null {
  const kind = selectedAction?.kind;

  if (kind === "approve" || node.interactionType === "approve" || node.interactionType === "confirm") {
    return "approve_result";
  }

  if (kind === "resolve") {
    return (node.interactiveFields?.length ?? 0) > 0 ? "submit_input" : "resume_after_unblock";
  }

  if (kind === "retry" || node.interactionType === "retry") {
    return "retry_node";
  }

  if (kind === "trigger" && node.executionMode === "manual") {
    return "mark_node_completed";
  }

  if (node.interactionType === "wait") {
    return "resume_after_unblock";
  }

  return "submit_input";
}

function buildCheckpointActionPayload(input: {
  action: CheckpointActionKind;
  inputFields: Record<string, string>;
  inputText: string;
  fallbackText?: string;
}) {
  const message = input.inputText || input.fallbackText;

  if (input.action === "submit_input") {
    return {
      inputFields: input.inputFields,
      message,
    };
  }

  if (input.action === "mark_node_completed") {
    return {
      summary: message,
      output: input.inputText || undefined,
    };
  }

  if (input.action === "reject_result" || input.action === "request_changes") {
    return {
      feedback: message,
    };
  }

  if (input.action === "retry_node") {
    return {
      prompt: message,
    };
  }

  if (input.action === "resume_after_unblock" || input.action === "request_replan" || input.action === "cancel_session" || input.action === "fail_task") {
    return {
      reason: message,
    };
  }

  return message ? { message } : undefined;
}

function buildWorkspaceInputFields(fields: PlanNodeField[], values: Record<string, string>) {
  return Object.fromEntries(
    fields
      .map((field) => [field.key, values[field.key]?.trim() ?? ""] as const)
      .filter(([, value]) => Boolean(value)),
  );
}

function buildWorkspaceInputText(fields: PlanNodeField[], values: Record<string, string>) {
  return fields
    .map((field) => {
      const value = values[field.key]?.trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

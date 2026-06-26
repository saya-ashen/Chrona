import type { CheckpointActionKind, SubmitCheckpointActionInput } from "@chrona/contracts/ai";
import { api } from "@/lib/rpc-client";
import type {
  PlanNodeAction,
  PlanNodeDataModel,
  PlanNodeField,
} from "@/components/tasks/plan/task-plan-graph/types";
import type { WorkspaceActivityPage, WorkspaceStateTreatment } from "./task-workspace-types";

export type LoadWorkspaceActivityPageInput = {
  taskId: string;
  cursor?: string;
  limit?: number;
};

export type LoadNodeWorkspaceActivityPageInput = LoadWorkspaceActivityPageInput & {
  nodeId: string;
};

async function readWorkspaceActivityResponse(response: Response, fallbackMessage: string): Promise<WorkspaceActivityPage> {
  const body = await response.json().catch(() => ({ error: fallbackMessage })) as unknown;
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? fallbackMessage);
  }

  return body as WorkspaceActivityPage;
}

export async function loadWorkspaceActivityPage(input: LoadWorkspaceActivityPageInput): Promise<WorkspaceActivityPage> {
  const response = await api.tasks[":taskId"].activity.$get({
    param: { taskId: input.taskId },
    query: {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: String(input.limit) } : {}),
    },
  });

  return readWorkspaceActivityResponse(response as unknown as Response, "Failed to load activity history");
}

export async function loadNodeWorkspaceActivityPage(input: LoadNodeWorkspaceActivityPageInput): Promise<WorkspaceActivityPage> {
  const response = await api.tasks[":taskId"].nodes[":nodeId"].activity.$get({
    param: { taskId: input.taskId, nodeId: input.nodeId },
    query: {
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.limit !== undefined ? { limit: String(input.limit) } : {}),
    },
  });

  return readWorkspaceActivityResponse(response as unknown as Response, "Failed to load node activity history");
}

type WorkspacePresentationInput = {
  currentNode: PlanNodeDataModel | null;
  hasPlan: boolean;
  allNodesDone: boolean;
  isBlocked?: boolean;
  isStale?: boolean;
  isPermissionLimited?: boolean;
  permissionSummary?: string;
  blockActionRequired?: string | null;
  copy?: Partial<WorkspaceStateTreatmentCopy>;
};

export type WorkspaceStateTreatmentCopy = {
  syncStaleLabel: string;
  syncStaleGuidance: string;
  viewOnlyLabel: string;
  viewOnlyGuidance: string;
  noPlanYetLabel: string;
  noPlanYetGuidance: string;
  completedLabel: string;
  completedGuidance: string;
  degradedLabel: string;
  degradedGuidance: string;
  blockedLabel: string;
  blockedGuidance: string;
  approvalRequiredLabel: string;
  approvalRequiredGuidance: string;
  reviewRequiredLabel: string;
  reviewRequiredGuidance: string;
  runningLabel: string;
  runningGuidance: string;
  idleLabel: string;
  idleGuidance: string;
};

export const DEFAULT_WORKSPACE_STATE_TREATMENT_COPY: WorkspaceStateTreatmentCopy = {
  syncStaleLabel: "Sync stale",
  syncStaleGuidance: "Refresh before acting on execution results.",
  viewOnlyLabel: "View only",
  viewOnlyGuidance: "You can view this task, but cannot run it.",
  noPlanYetLabel: "No plan yet",
  noPlanYetGuidance: "Generate and accept a plan to unlock execution controls.",
  completedLabel: "Completed",
  completedGuidance: "Review the latest result and artifacts before closing the task.",
  degradedLabel: "Degraded",
  degradedGuidance: "Retry sync or repair this node before continuing execution.",
  blockedLabel: "Blocked",
  blockedGuidance: "Resolve the blocker before continuing execution.",
  approvalRequiredLabel: "Approval required",
  approvalRequiredGuidance: "Approve or reject the current node to continue.",
  reviewRequiredLabel: "Review required",
  reviewRequiredGuidance: "Complete the current node action to continue.",
  runningLabel: "Running",
  runningGuidance: "Monitor current execution progress.",
  idleLabel: "Idle",
  idleGuidance: "Select a plan node or start execution when ready.",
};

export type WorkspaceActionDisabledReasonCopy = {
  actionAlreadySending: string;
  completeRequiredField: string;
  completeRequiredFields: string;
};

export const DEFAULT_WORKSPACE_ACTION_DISABLED_REASON_COPY: WorkspaceActionDisabledReasonCopy = {
  actionAlreadySending: "Action is already being sent.",
  completeRequiredField: "Complete required field: {fields}.",
  completeRequiredFields: "Complete required fields: {fields}.",
};

function resolveStateTreatmentCopy(copy?: Partial<WorkspaceStateTreatmentCopy>) {
  return { ...DEFAULT_WORKSPACE_STATE_TREATMENT_COPY, ...copy };
}

function resolveActionDisabledReasonCopy(copy?: Partial<WorkspaceActionDisabledReasonCopy>) {
  return { ...DEFAULT_WORKSPACE_ACTION_DISABLED_REASON_COPY, ...copy };
}

function fillFields(template: string, fields: string) {
  return template.replace("{fields}", fields);
}

export function buildWorkspaceStateTreatment(input: WorkspacePresentationInput): WorkspaceStateTreatment {
  const copy = resolveStateTreatmentCopy(input.copy);

  if (input.isStale) {
    return {
      label: copy.syncStaleLabel,
      tone: "warning",
      guidance: copy.syncStaleGuidance,
    };
  }

  if (input.isPermissionLimited) {
    return {
      label: copy.viewOnlyLabel,
      tone: "warning",
      guidance: input.permissionSummary ?? copy.viewOnlyGuidance,
    };
  }

  if (!input.hasPlan) {
    return {
      label: copy.noPlanYetLabel,
      tone: "neutral",
      guidance: copy.noPlanYetGuidance,
    };
  }

  if (input.allNodesDone) {
    return {
      label: copy.completedLabel,
      tone: "success",
      guidance: copy.completedGuidance,
    };
  }

  if (input.currentNode?.status === "degraded") {
    return {
      label: copy.degradedLabel,
      tone: "critical",
      guidance: input.currentNode.nextAction ?? copy.degradedGuidance,
    };
  }

  if (input.currentNode?.status === "blocked" || input.currentNode?.status === "failed") {
    return {
      label: copy.blockedLabel,
      tone: "critical",
      guidance: input.blockActionRequired ?? input.currentNode.nextAction ?? copy.blockedGuidance,
    };
  }

  if (input.currentNode?.status === "waiting_for_approval") {
    return {
      label: copy.approvalRequiredLabel,
      tone: "warning",
      guidance: input.currentNode.nextAction ?? copy.approvalRequiredGuidance,
    };
  }

  if (input.currentNode?.status === "waiting_for_user" || input.currentNode?.requiresHumanInput === true) {
    return {
      label: copy.reviewRequiredLabel,
      tone: "warning",
      guidance: input.currentNode.nextAction ?? copy.reviewRequiredGuidance,
    };
  }

  if (input.currentNode?.status === "active" || input.currentNode?.status === "in_progress") {
    return {
      label: copy.runningLabel,
      tone: "info",
      guidance: input.currentNode.nextAction ?? copy.runningGuidance,
    };
  }

  if (input.isBlocked) {
    return {
      label: copy.blockedLabel,
      tone: "critical",
      guidance: input.blockActionRequired ?? copy.blockedGuidance,
    };
  }

  return {
    label: copy.idleLabel,
    tone: "neutral",
    guidance: input.currentNode?.nextAction ?? copy.idleGuidance,
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
  copy?: Partial<WorkspaceActionDisabledReasonCopy>;
}) {
  const copy = resolveActionDisabledReasonCopy(input.copy);

  if (input.isDispatching) return copy.actionAlreadySending;
  if (input.baseReason) return input.baseReason;

  const missingFields = getMissingWorkspaceActionFields(input.fields, input.values);
  if (missingFields.length > 0) {
    const template = missingFields.length === 1 ? copy.completeRequiredField : copy.completeRequiredFields;
    return fillFields(template, missingFields.map((field) => field.label).join(", "));
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

export function actionKindForNode(node: PlanNodeDataModel, selectedAction: PlanNodeAction | null): CheckpointActionKind | null {
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
      .map((field) => [field.key, values[field.key].trim()] as const)
      .filter(([, value]) => Boolean(value)),
  );
}

function buildWorkspaceInputText(fields: PlanNodeField[], values: Record<string, string>) {
  return fields
    .map((field) => {
      const value = values[field.key].trim();
      return value ? `${field.label}: ${value}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

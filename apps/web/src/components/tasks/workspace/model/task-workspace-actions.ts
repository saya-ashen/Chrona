import type { ExecutionActionInput } from "@chrona/contracts/ai";
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

  if (input.isBlocked) {
    return {
      label: "Blocked",
      tone: workspaceStateToneByLabel.Blocked,
      guidance: input.blockActionRequired ?? "Resolve the blocker before continuing execution.",
    };
  }

  if (input.currentNode?.status === "active" || input.currentNode?.status === "in_progress") {
    return {
      label: "Running",
      tone: workspaceStateToneByLabel.Running,
      guidance: input.currentNode.nextAction ?? "Monitor current execution progress.",
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

export function buildWorkspaceActionInput(input: {
  node: PlanNodeDataModel;
  selectedAction: PlanNodeAction | null;
  fields: PlanNodeField[];
  values: Record<string, string>;
}): ExecutionActionInput {
  const kind = input.selectedAction?.kind;
  const inputText = buildWorkspaceInputText(input.fields, input.values);
  const inputFields = buildWorkspaceInputFields(input.fields, input.values);
  const selectedDecision = input.values["checkpoint:decision"]?.trim().toLowerCase();

  if (
    kind === "approve" ||
    input.node.interactionType === "approve" ||
    input.node.interactionType === "confirm"
  ) {
    return {
      action: "resume_with_approval",
      nodeId: input.node.id,
      decision: selectedDecision?.includes("reject") ? "reject" : "approve",
      feedback: inputText || undefined,
    };
  }

  if (kind === "resolve") {
    if (input.fields.length > 0) {
      return {
        action: "resume_with_input",
        nodeId: input.node.id,
        inputFields,
      };
    }

    return {
      action: "resume_after_unblock",
      nodeId: input.node.id,
      note: inputText || input.node.nextAction || undefined,
    };
  }

  if (kind === "retry" || input.node.interactionType === "retry") {
    return {
      action: "retry_node",
      nodeId: input.node.id,
      prompt: inputText || input.node.nextAction || undefined,
    };
  }

  if (kind === "trigger" || input.node.interactionType === "execute") {
    if (input.node.executionMode === "manual") {
      return {
        action: "complete_manual_node",
        nodeId: input.node.id,
        summary: inputText || input.node.nextAction || `Manual node ${input.node.title} completed`,
        output: inputText || undefined,
      };
    }

    return {
      action: "start_manual",
      prompt: inputText || input.node.nextAction || undefined,
    };
  }

  if (input.node.interactionType === "wait") {
    return {
      action: "resume_after_unblock",
      nodeId: input.node.id,
      note: inputText || input.node.nextAction || undefined,
    };
  }

  return {
    action: "resume_with_input",
    nodeId: input.node.id,
    inputFields,
  };
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

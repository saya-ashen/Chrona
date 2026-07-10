import type { TaskAction } from "@chrona/contracts";
import type { ExecutionActionInput } from "@chrona/contracts/ai";
import type {
  ExecutionOverviewTone,
  TaskPlanGenerationStatus,
} from "./task-workspace-types";

export type CommandCenterPrimaryActionKind =
  | "generate"
  | "accept-or-regenerate"
  | "task-completed"
  | "task-primary-action"
  | "start-plan"
  | "current-operation"
  | "no-operation";

export type CommandCenterPrimaryActionDescriptor = {
  kind: CommandCenterPrimaryActionKind;
  label: string;
  description: string;
  statusLabel?: string;
  tone?: ExecutionOverviewTone;
  disabled?: boolean;
  isLoading?: boolean;
  suppressAttentionCard?: boolean;
};

export function dispatchInputForPrimaryAction(
  action: TaskAction,
  nodeId: string | null,
): ExecutionActionInput | null {
  switch (action.type) {
    case "start":
      return { action: "start_manual" };
    case "retry_sync":
      return nodeId ? { action: "retry_node", nodeId } : null;
    case "resume":
      return { action: "resume_after_unblock", ...(nodeId ? { nodeId } : {}) };
    case "cancel":
      return { action: "cancel_session" };
    case "pause":
      return { action: "pause_session" };
    case "provide_input":
    case "approve":
    case "replan":
    case "none":
    case "cancel_execution":
    case "replan_from_node":
    case "repair_inconsistency":
      return null;
  }
}

export function primaryActionTone(action: TaskAction): ExecutionOverviewTone {
  switch (action.type) {
    case "retry_sync":
    case "cancel":
    case "cancel_execution":
      return "critical";
    case "provide_input":
    case "approve":
    case "resume":
    case "replan":
    case "replan_from_node":
      return "warning";
    case "start":
      return "success";
    case "pause":
    case "none":
    case "repair_inconsistency":
      return "neutral";
  }
}

export type CommandCenterPrimaryActionInput = {
  hasPlan: boolean;
  planStatus: string | null;
  isPlanAwaitingAcceptance: boolean;
  planGenerationStatus: TaskPlanGenerationStatus;
  isGeneratingPlan: boolean;
  hasTaskCompleted: boolean;
  hasGraphExecutionStarted: boolean;
  shouldUseTaskPrimaryAction: boolean;
  taskPrimaryAction: TaskAction | null;
  shouldShowCurrentOperation: boolean;
  currentOperationStatusLabel: string | null;
  currentOperationDescription: string | null;
  currentOperationTone: ExecutionOverviewTone;
  primaryStateLabel: string | null;
  taskStatus: string;
  runnabilitySummary: string | null;
  blockActionRequired: string | null;
  blockType: string | null;
};

export function resolveCommandCenterPrimaryAction(
  input: CommandCenterPrimaryActionInput,
): CommandCenterPrimaryActionDescriptor {
  if (input.hasTaskCompleted) {
    return {
      kind: "task-completed",
      label: "Task completed",
      description:
        "Execution has finished. Review the result, artifacts, or activity history if needed.",
      statusLabel: input.primaryStateLabel ?? input.taskStatus,
      tone: "success",
      suppressAttentionCard: true,
    };
  }

  if (!input.hasPlan) {
    return {
      kind: "generate",
      label: input.isGeneratingPlan ? "Generating..." : "Generate plan",
      description: input.isGeneratingPlan
        ? "A fresh plan is being generated for this task."
        : "Create an execution plan before starting task work.",
      statusLabel: input.planGenerationStatus,
      tone: "info",
      disabled: input.isGeneratingPlan,
      isLoading: input.isGeneratingPlan,
    };
  }

  if (input.isPlanAwaitingAcceptance) {
    return {
      kind: "accept-or-regenerate",
      label: "Accept or regenerate plan",
      description:
        "Review this draft plan. Accept it to enable execution, or regenerate it with user instructions.",
      statusLabel:
        input.planGenerationStatus === "waiting_acceptance"
          ? input.planGenerationStatus
          : (input.planStatus ?? undefined),
      tone: "info",
    };
  }

  if (input.shouldUseTaskPrimaryAction && input.taskPrimaryAction) {
    return {
      kind: "task-primary-action",
      label: input.taskPrimaryAction.label,
      description:
        input.runnabilitySummary ||
        input.blockActionRequired ||
        "Complete the required execution action to continue the accepted plan.",
      statusLabel:
        input.blockType ?? input.primaryStateLabel ?? input.taskStatus,
      tone: primaryActionTone(input.taskPrimaryAction),
    };
  }

  if (
    !input.hasGraphExecutionStarted ||
    (input.taskPrimaryAction?.type === "start" &&
      input.taskPrimaryAction.enabled)
  ) {
    const hasStarted = input.hasGraphExecutionStarted;
    return {
      kind: "start-plan",
      label: hasStarted ? "Continue plan" : "Start plan",
      description: hasStarted
        ? "Continue the accepted plan from its persisted execution state."
        : "Run the accepted plan and move into the first executable step.",
      statusLabel: input.planStatus ?? undefined,
      tone: "success",
    };
  }

  if (input.shouldShowCurrentOperation) {
    return {
      kind: "current-operation",
      label: "Current node action",
      description:
        input.currentOperationDescription ??
        "Complete the current node action to continue.",
      statusLabel: input.currentOperationStatusLabel ?? undefined,
      tone: input.currentOperationTone,
    };
  }

  return {
    kind: "no-operation",
    label: "No current operation",
    description:
      "The accepted plan is running, but the engine has not returned an actionable checkpoint yet.",
    statusLabel: input.primaryStateLabel ?? input.taskStatus,
    tone: "neutral",
    suppressAttentionCard: true,
  };
}

import type { UiDocument } from "@chrona/ui-protocol";
import type { TaskAction } from "@chrona/contracts";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../../../apps/web/src/components/tasks/plan/task-plan-graph/types";
import type { WorkspaceRuntimeEvent } from "../../execution-monitoring";
import type { TaskPageData, TaskPlanGenerationStatus } from "./task-workspace-types";

export type TaskWorkspaceOperationStatus =
  | "plan-empty"
  | "plan-generating"
  | "plan-review"
  | "plan-ready-to-run"
  | "task-action"
  | "execution-action"
  | "execution-blocked"
  | "execution-running"
  | "execution-completed";

type OperationTone = "neutral" | "info" | "success" | "warning" | "critical";
type OperationHandler = (params: Record<string, unknown>) => Promise<unknown> | unknown;

type BaseOperationState = {
  status: TaskWorkspaceOperationStatus;
  title: string;
  description: string;
  statusLabel?: string | null;
  tone: OperationTone;
  selectedNode: PlanNodeDataModel | null;
  currentNode: PlanNodeDataModel | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
};

export type TaskWorkspaceOperationState =
  | (BaseOperationState & { status: "plan-empty"; action: "generate-plan"; isGeneratingPlan: false })
  | (BaseOperationState & { status: "plan-generating"; action: "none"; isGeneratingPlan: true })
  | (BaseOperationState & { status: "plan-review"; action: "review-plan"; canAcceptPlan: boolean; acceptPlanError: string | null; visibleGenerationInstruction: string | null })
  | (BaseOperationState & { status: "plan-ready-to-run"; action: "start-plan"; hasGraphExecutionStarted: boolean })
  | (BaseOperationState & { status: "task-action"; action: "task-primary-action"; taskPrimaryAction: TaskAction })
  | (BaseOperationState & { status: "execution-action"; action: "current-operation"; operationSpec: UiDocument | null; actionHandlers: Record<string, OperationHandler>; onActionStateChange?: (changes: Array<{ path: string; value: unknown }>) => void })
  | (BaseOperationState & { status: "execution-blocked"; action: "current-operation"; operationSpec: UiDocument | null; actionHandlers: Record<string, OperationHandler>; onActionStateChange?: (changes: Array<{ path: string; value: unknown }>) => void })
  | (BaseOperationState & { status: "execution-running"; action: "none" })
  | (BaseOperationState & { status: "execution-completed"; action: "none" });

export type ResolveTaskWorkspaceOperationStateInput = {
  plan: { status: string; prompt?: string | null; summary?: string | null } | null;
  planGenerationStatus: TaskPlanGenerationStatus;
  canAcceptPlan?: boolean;
  acceptPlanError: string | null;
  generationUserInstruction?: string | null;
  graphPlan: TaskPlanGraphPlan | null;
  pageData: TaskPageData;
  currentNode: PlanNodeDataModel | null;
  selectedNode: PlanNodeDataModel | null;
  hasTaskCompleted: boolean;
  hasGraphExecutionStarted: boolean;
  hasCurrentOperationControls: boolean;
  shouldShowCurrentOperation: boolean;
  currentOperationSpec: UiDocument | null;
  currentOperationHandlers: Record<string, OperationHandler>;
  onCurrentOperationStateChange?: (changes: Array<{ path: string; value: unknown }>) => void;
  shouldUseTaskPrimaryAction: boolean;
  taskPrimaryAction: TaskAction | null;
  runtimeEvents: WorkspaceRuntimeEvent[];
};

function planDescription(input: ResolveTaskWorkspaceOperationStateInput) {
  return input.plan?.summary?.trim()
    || input.plan?.prompt?.trim()
    || input.generationUserInstruction?.trim()
    || "Review the draft plan before execution.";
}

function currentOperationDescription(input: ResolveTaskWorkspaceOperationStateInput) {
  return input.currentNode?.nextAction
    ?? input.currentNode?.summary
    ?? input.pageData.task.runnabilitySummary
    ?? input.pageData.task.blockReason?.actionRequired
    ?? "Review the current execution state.";
}

function runningDescription(input: ResolveTaskWorkspaceOperationStateInput) {
  const latestRuntime = input.runtimeEvents.at(-1)?.event;
  if (!latestRuntime) return currentOperationDescription(input);
  switch (latestRuntime.type) {
    case "assistant_text_delta":
    case "reasoning_delta":
      return latestRuntime.text.trim() || currentOperationDescription(input);
    case "tool_started":
      return latestRuntime.label;
    case "tool_completed":
      return latestRuntime.error ? `${latestRuntime.label} failed` : `${latestRuntime.label} completed`;
    case "approval_required":
      return "Approval required.";
    case "run_status":
      return latestRuntime.message ?? latestRuntime.status;
    case "raw_event":
      return latestRuntime.rawEventType ?? "Runtime event";
  }
}

export function resolveTaskWorkspaceOperationState(input: ResolveTaskWorkspaceOperationStateInput): TaskWorkspaceOperationState {
  const base = {
    selectedNode: input.selectedNode,
    currentNode: input.currentNode,
    runtimeEvents: input.runtimeEvents,
  };
  const isGeneratingPlan = input.planGenerationStatus === "generating";
  const isPlanAccepted = input.plan?.status === "accepted";

  if (!input.plan) {
    if (isGeneratingPlan) {
      return {
        ...base,
        status: "plan-generating",
        action: "none",
        isGeneratingPlan: true,
        title: "Generating plan…",
        description: input.generationUserInstruction?.trim() || "Chrona is drafting an execution plan.",
        statusLabel: "Generating",
        tone: "info",
      };
    }
    return {
      ...base,
      status: "plan-empty",
      action: "generate-plan",
      isGeneratingPlan: false,
      title: "No accepted plan",
      description: "Generate a plan before execution can start.",
      statusLabel: null,
      tone: "info",
    };
  }

  if (!isPlanAccepted) {
    return {
      ...base,
      status: "plan-review",
      action: "review-plan",
      title: input.acceptPlanError ? "Plan review needs attention" : "Plan ready for review",
      description: planDescription(input),
      statusLabel: input.acceptPlanError ? "Review needed" : (input.planGenerationStatus || input.plan.status),
      tone: input.acceptPlanError ? "warning" : "info",
      canAcceptPlan: Boolean(input.canAcceptPlan),
      acceptPlanError: input.acceptPlanError,
      visibleGenerationInstruction: input.plan.prompt?.trim() || input.generationUserInstruction?.trim() || null,
    };
  }

  if (input.hasTaskCompleted) {
    return {
      ...base,
      status: "execution-completed",
      action: "none",
      title: "Execution completed",
      description: "Review the latest result, artifacts, and activity.",
      statusLabel: null,
      tone: "success",
    };
  }

  if (input.shouldUseTaskPrimaryAction && input.taskPrimaryAction) {
    return {
      ...base,
      status: "task-action",
      action: "task-primary-action",
      taskPrimaryAction: input.taskPrimaryAction,
      title: input.taskPrimaryAction.label,
      description: input.pageData.task.runnabilitySummary
        || input.pageData.task.blockReason?.actionRequired
        || "Complete the required task action to continue.",
      statusLabel: input.pageData.task.blockReason?.blockType ?? input.pageData.task.status,
      tone: input.taskPrimaryAction.type === "retry_sync" || input.taskPrimaryAction.type === "cancel" || input.taskPrimaryAction.type === "cancel_execution"
        ? "critical"
        : "warning",
    };
  }

  if (!input.hasGraphExecutionStarted || (input.taskPrimaryAction?.type === "start" && input.taskPrimaryAction.enabled)) {
    return {
      ...base,
      status: "plan-ready-to-run",
      action: "start-plan",
      title: "Plan accepted",
      description: input.hasGraphExecutionStarted ? "Continue the accepted plan from the current state." : "Start the accepted plan when ready.",
      statusLabel: input.plan.status,
      hasGraphExecutionStarted: input.hasGraphExecutionStarted,
      tone: "success",
    };
  }

  if (input.shouldShowCurrentOperation && input.currentNode) {
    const blocked = input.currentNode.status === "blocked" || Boolean(input.pageData.task.blockReason);
    return {
      ...base,
      status: blocked ? "execution-blocked" : "execution-action",
      action: "current-operation",
      title: blocked ? "Action required" : (input.currentNode.title || "Current operation"),
      description: currentOperationDescription(input),
      statusLabel: input.currentNode.statusLabel ?? input.currentNode.status,
      tone: blocked ? "warning" : "info",
      operationSpec: input.currentOperationSpec,
      actionHandlers: input.currentOperationHandlers,
      onActionStateChange: input.onCurrentOperationStateChange,
    };
  }

  return {
    ...base,
    status: "execution-running",
    action: "none",
    title: input.currentNode?.title ?? "Execution running",
    description: runningDescription(input),
    statusLabel: input.currentNode?.statusLabel ?? input.pageData.task.status,
    tone: "info",
  };
}

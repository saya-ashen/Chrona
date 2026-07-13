import type { TaskAction } from "@chrona/contracts";
import type { ExecutionActionInput } from "@chrona/contracts"
import type { PlanNodeAction, PlanNodeDataModel, PlanNodeInteractionType, TaskPlanGraphPlan } from "./task-plan-graph/types";

type ActionPageData = {
  taskShell?: {
    blockReason?: { nodeId?: string | null } | null;
    executionSummary?: {
      currentNodeId?: string | null;
      primaryAction?: TaskAction | null;
    } | null;
  } | null;
  task?: {
    blockReason?: { nodeId?: string | null } | null;
    executionSummary?: {
      currentNodeId?: string | null;
      primaryAction?: TaskAction | null;
    } | null;
  } | null;
};

export function graphNodeIdForTaskAction(
  action: TaskAction | null | undefined,
  pageData: ActionPageData,
  graphPlan: TaskPlanGraphPlan | null,
) {
  return action?.targetNodeId
    ?? pageData.taskShell?.executionSummary?.currentNodeId
    ?? pageData.task?.executionSummary?.currentNodeId
    ?? pageData.taskShell?.blockReason?.nodeId
    ?? pageData.task?.blockReason?.nodeId
    ?? graphPlan?.currentStepId
    ?? graphPlan?.nodes.find((node) => node.status === "failed" || node.status === "blocked")?.id
    ?? null;
}

export function executionInputForTaskAction(action: TaskAction, nodeId: string | null): ExecutionActionInput | null {
  switch (action.type) {
    case "retry_sync":
      return nodeId ? { action: "retry_node", nodeId } : null;
    case "resume":
      return { action: "resume_after_unblock", ...(nodeId ? { nodeId } : {}) };
    case "cancel":
      return { action: "cancel_session" };
    case "pause":
      return { action: "pause_session" };
    case "start":
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

export function nodeActionKindForTaskAction(action: TaskAction): PlanNodeAction["kind"] {
  switch (action.type) {
    case "retry_sync":
      return "retry";
    case "resume":
    case "replan":
    case "replan_from_node":
    case "repair_inconsistency":
      return "resolve";
    case "provide_input":
      return "input";
    case "approve":
      return "approve";
    case "cancel":
    case "cancel_execution":
    case "pause":
    case "start":
    case "none":
      return "trigger";
  }
}

export function nodeActionEmphasisForTaskAction(action: TaskAction): PlanNodeAction["emphasis"] {
  switch (action.type) {
    case "retry_sync":
    case "cancel":
    case "cancel_execution":
      return "danger";
    case "resume":
    case "replan":
    case "replan_from_node":
      return "warning";
    case "provide_input":
    case "approve":
    case "start":
      return "primary";
    case "pause":
    case "none":
    case "repair_inconsistency":
      return "default";
  }
}

function nodeInteractionTypeForTaskAction(action: TaskAction): PlanNodeInteractionType {
  switch (action.type) {
    case "retry_sync":
      return "retry";
    case "provide_input":
      return "input";
    case "approve":
      return "approve";
    case "resume":
      return "wait";
    case "replan":
    case "replan_from_node":
    case "repair_inconsistency":
    case "cancel":
    case "cancel_execution":
    case "pause":
    case "start":
    case "none":
      return "observe";
  }
}

export function appendTaskPrimaryNodeAction(
  pageData: ActionPageData,
  graphPlan: TaskPlanGraphPlan | null,
): TaskPlanGraphPlan | null {
  const action = pageData.taskShell?.executionSummary?.primaryAction
    ?? pageData.task?.executionSummary?.primaryAction;
  if (!graphPlan || !action?.enabled || action.type === "none") return graphPlan;

  const nodeId = graphNodeIdForTaskAction(action, pageData, graphPlan);
  const executionAction = executionInputForTaskAction(action, nodeId);
  if (!nodeId || !executionAction) return graphPlan;

  const recoveryAction: PlanNodeAction = {
    id: `task-primary:${action.type}:${nodeId}`,
    label: action.label,
    kind: nodeActionKindForTaskAction(action),
    emphasis: nodeActionEmphasisForTaskAction(action),
    executionAction,
  };
  const interactionType = nodeInteractionTypeForTaskAction(action);
  const nodes = graphPlan.nodes.map((node) => withTaskPrimaryNodeAction(node, nodeId, recoveryAction, action.label, interactionType));

  return {
    ...graphPlan,
    nodes,
    steps: graphPlan.steps ? graphPlan.steps.map((node) => withTaskPrimaryNodeAction(node, nodeId, recoveryAction, action.label, interactionType)) : graphPlan.steps,
  };
}

function withTaskPrimaryNodeAction(
  node: PlanNodeDataModel,
  nodeId: string,
  recoveryAction: PlanNodeAction,
  fallbackNextAction: string,
  interactionType: PlanNodeInteractionType,
) {
  if (node.id !== nodeId) return node;
  const existingActions = node.availableActions ?? [];
  if (existingActions.some((candidate) => candidate.id === recoveryAction.id)) return node;
  return {
    ...node,
    actionable: true,
    availableActions: [recoveryAction, ...existingActions],
    interactionType: node.interactionType ?? interactionType,
    nextAction: node.nextAction ?? fallbackNextAction,
  };
}

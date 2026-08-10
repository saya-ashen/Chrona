import type { PlanNodeDataModel, TaskPlanGraphPlan } from "../plan/task-plan-graph/types";
import type { TaskAction } from "@chrona/contracts";
import type { TaskPageData } from "../model/task-workspace-types";

export type WorkspaceCopy = Record<string, string | undefined>;

export function isCompletedGraphNode(status: string) {
  return status === "done" || status === "completed" || status === "skipped";
}

function isSyntheticStartingNodeWithoutExecutionEvidence(
  node: TaskPlanGraphPlan["nodes"][number],
) {
  return node.metadata?.launchState === "starting";
}

export function hasStartedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  return (graphPlan?.nodes ?? []).some((node) => {
    if (isSyntheticStartingNodeWithoutExecutionEvidence(node)) return false;
    return (
      node.status !== "idle" &&
      node.status !== "pending" &&
      node.status !== "ready"
    );
  });
}

export function hasNodeActionPayload(node: PlanNodeDataModel | null) {
  if (!node) return false;
  if ((node.availableActions?.length ?? 0) > 0) return true;
  if ((node.interactiveFields?.length ?? 0) === 0) return false;
  const submittedInput = node.inputFields && Object.values(node.inputFields).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "boolean" ? true : value.trim().length > 0,
  );
  return (
    !(node.status === "done" || node.status === "skipped") || !submittedInput
  );
}

export function isCompletedTaskStatus(status: string | null | undefined) {
  const normalized = status?.toLowerCase() ?? "";
  return (
    normalized === "done" ||
    normalized === "completed" ||
    normalized === "complete"
  );
}

export function hasCompletedGraphExecution(graphPlan: TaskPlanGraphPlan | null) {
  const nodes = graphPlan?.nodes ?? [];
  return (
    nodes.length > 0 && nodes.every((node) => isCompletedGraphNode(node.status))
  );
}

export function derivePreferredGraphMode(input: {
  currentMode: "full" | "compact";
  isGeneratingPlan: boolean;
  hasGraphExecutionStarted: boolean;
  hasTaskCompleted: boolean;
}): "full" | "compact" {
  if (input.isGeneratingPlan) return "full";
  if (input.hasGraphExecutionStarted || input.hasTaskCompleted)
    return "compact";
  return input.currentMode;
}

export function recoveryActionButtonVariant(
  actionType: TaskAction["type"],
): "default" | "outline" | "destructive" {
  if (actionType === "cancel" || actionType === "cancel_execution")
    return "destructive";
  if (
    actionType === "retry_sync" ||
    actionType === "repair_inconsistency" ||
    actionType === "replan_from_node"
  )
    return "default";
  return "outline";
}

export function graphNodeIdForAction(
  action: TaskAction | null | undefined,
  pageData: TaskPageData,
  graphPlan: TaskPlanGraphPlan | null,
) {
  return (
    action?.targetNodeId ??
    pageData.task.executionSummary?.currentNodeId ??
    graphPlan?.currentStepId ??
    graphPlan?.nodes.find(
      (node) => node.status === "failed" || node.status === "blocked",
    )?.id ??
    null
  );
}

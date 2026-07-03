import { deriveWorkItemStateView, type WorkItemStateView } from "@chrona/domain";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { ExecutionOverviewTone, ProgressSummary, TaskData, TaskHeaderAction, TaskWorkspaceUserStatus } from "./task-workspace-types";

export function isDoneStatus(status: PlanNodeDataModel["status"]) {
  return status === "done" || status === "completed" || status === "skipped" || status === "cancelled" || status === "invalidated";
}

export function isAttentionStatus(status: PlanNodeDataModel["status"]) {
  return status === "waiting"
    || status === "waiting_for_user"
    || status === "waiting_for_approval"
    || status === "blocked"
    || status === "failed"
    || status === "degraded";
}

export function isCheckpointStatus(status: PlanNodeDataModel["status"]) {
  return status === "waiting" || status === "waiting_for_user" || status === "waiting_for_approval";
}

export function deriveTaskStatusFromGraph(
  task: TaskData,
  graphPlan: TaskPlanGraphPlan | null,
) {
  const taskStatus = task.currentWorkBlock?.status && task.currentWorkBlock.status !== "Completed"
    ? task.currentWorkBlock.status
    : task.status;
  const nodes = graphPlan?.nodes ?? [];
  if (nodes.length === 0) return taskStatus;

  if (nodes.some((node) => node.status === "active" || node.status === "in_progress")) {
    return "Running";
  }

  if (nodes.some((node) => node.status === "waiting_for_approval")) {
    return "WaitingForApproval";
  }

  if (nodes.some((node) => node.status === "waiting_for_user")) {
    return "WaitingForInput";
  }

  if (nodes.some((node) => node.status === "blocked" || node.status === "failed" || node.status === "degraded")) {
    return "Blocked";
  }

  if (taskStatus === task.status && nodes.every((node) => isDoneStatus(node.status))) {
    return "Completed";
  }

  return taskStatus;
}

export function stateViewForWorkspaceStatus(input: {
  taskStatus?: string | null;
  scheduleStatus?: string | null;
  planStatus?: string | null;
  executionStatus?: string | null;
  nodeStatus?: string | null;
  providerStatus?: string | null;
  isScheduled?: boolean;
  hasPlan?: boolean;
  isRunnable?: boolean;
  disabledReason?: string | null;
}): WorkItemStateView {
  return deriveWorkItemStateView(input);
}

export function mapTaskWorkspaceStatus(status: string): TaskWorkspaceUserStatus {
  const stateView = stateViewForWorkspaceStatus({ taskStatus: status, nodeStatus: status });
  if (stateView.state === "completed" || stateView.state === "cancelled") return "completed";
  if (stateView.state === "running") return "running";
  if (stateView.state === "waiting_for_approval") return "approval-needed";
  if (stateView.state === "waiting_for_input") return "input-needed";
  if (stateView.state === "blocked" || stateView.state === "failed") return "blocked";
  return "waiting";
}

export function overviewToneForNode(node: PlanNodeDataModel | null): ExecutionOverviewTone {
  if (!node) return "neutral";
  if (node.status === "blocked" || node.status === "failed" || node.status === "degraded") return "critical";
  if (isAttentionStatus(node.status)) return "warning";
  if (isDoneStatus(node.status)) return "success";
  if (node.status === "active" || node.status === "in_progress" || node.status === "ready") return "info";
  return "neutral";
}

export type HeaderActionCopy = {
  generateAndAcceptPlanBeforeStart: string;
  acceptGeneratedPlanBeforeStart: string;
  taskAlreadyRunning: string;
  taskWaitingForCheckpointInput: string;
  resolveBlockerBeforeStart: string;
  taskCompleted: string;
  noRunningExecutionToStop: string;
  noRunningExecutionToPause: string;
  start: string;
  pause: string;
  stop: string;
  moreActions: string;
};

export function deriveWorkspacePresentationState(input: {
  task: TaskData;
  progress: ProgressSummary;
  currentNode: PlanNodeDataModel | null;
}): TaskWorkspaceUserStatus {
  const allNodesDone = input.progress.totalSteps > 0 && input.progress.completedSteps === input.progress.totalSteps;
  const currentNodeStatus = !allNodesDone && input.currentNode && (isAttentionStatus(input.currentNode.status) || input.currentNode.status === "active" || input.currentNode.status === "in_progress")
    ? mapTaskWorkspaceStatus(input.currentNode.status)
    : null;

  return currentNodeStatus ?? (input.task.executionSummary
    ? mapTaskWorkspaceStatus(input.task.executionSummary.executionState)
    : mapTaskWorkspaceStatus(input.task.status));
}

export function deriveHeaderActions(input: {
  task: TaskData;
  progress: ProgressSummary;
  workspaceStatus: TaskWorkspaceUserStatus;
  copy: HeaderActionCopy;
}): TaskHeaderAction[] {
  const hasPlan = input.progress.totalSteps > 0 || Boolean(input.task.savedPlan);
  const hasUnacceptedSavedPlan = Boolean(input.task.savedPlan && input.task.savedPlan.status !== "accepted");
  const cannotStartReason = !hasPlan
    ? input.copy.generateAndAcceptPlanBeforeStart
    : hasUnacceptedSavedPlan
      ? input.copy.acceptGeneratedPlanBeforeStart
    : !input.task.isRunnable
      ? input.task.runnabilitySummary
    : input.workspaceStatus === "running"
        ? input.copy.taskAlreadyRunning
        : input.workspaceStatus === "approval-needed" || input.workspaceStatus === "input-needed"
          ? input.copy.taskWaitingForCheckpointInput
        : input.workspaceStatus === "blocked"
          ? input.copy.resolveBlockerBeforeStart
        : input.workspaceStatus === "completed"
          ? input.copy.taskCompleted
          : undefined;
  const cannotStopReason = input.workspaceStatus === "running" || input.workspaceStatus === "approval-needed" || input.workspaceStatus === "input-needed"
    ? undefined
    : input.copy.noRunningExecutionToStop;
  const cannotPauseReason = input.workspaceStatus === "running"
    ? undefined
    : input.copy.noRunningExecutionToPause;

  return [
    { id: "start", label: input.copy.start, disabled: Boolean(cannotStartReason), disabledReason: cannotStartReason },
    { id: "pause", label: input.copy.pause, disabled: Boolean(cannotPauseReason), disabledReason: cannotPauseReason },
    { id: "stop", label: input.copy.stop, disabled: Boolean(cannotStopReason), disabledReason: cannotStopReason },
    { id: "more", label: input.copy.moreActions },
  ];
}

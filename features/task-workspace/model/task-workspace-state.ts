import { deriveWorkStateView, type WorkStateView } from "@chrona/domain";
import type {
  PlanNodeDataModel,
  TaskPlanGraphPlan,
} from "@/components/tasks/plan/task-plan-graph/types";
import type {
  ExecutionOverviewTone,
  ProgressSummary,
  TaskData,
  TaskHeaderAction,
  TaskWorkspaceUserStatus,
} from "./task-workspace-types";

export function isDoneStatus(status: PlanNodeDataModel["status"]) {
  return (
    status === "done" ||
    status === "completed" ||
    status === "skipped" ||
    status === "cancelled" ||
    status === "invalidated"
  );
}

export function isAttentionStatus(status: PlanNodeDataModel["status"]) {
  return (
    status === "waiting" ||
    status === "waiting_for_user" ||
    status === "waiting_for_approval" ||
    status === "blocked" ||
    status === "failed" ||
    status === "degraded"
  );
}

export function isCheckpointStatus(status: PlanNodeDataModel["status"]) {
  return (
    status === "waiting" ||
    status === "waiting_for_user" ||
    status === "waiting_for_approval"
  );
}

export function deriveTaskStatusFromGraph(
  task: TaskData,
  graphPlan: TaskPlanGraphPlan | null,
) {
  const taskStatus =
    task.currentWorkBlock?.status &&
    task.currentWorkBlock.status !== "Completed"
      ? task.currentWorkBlock.status
      : task.status;
  const nodes = graphPlan?.nodes ?? [];
  if (nodes.length === 0) return taskStatus;

  if (
    nodes.some(
      (node) => node.status === "active" || node.status === "in_progress",
    )
  ) {
    return "Running";
  }

  if (nodes.some((node) => node.status === "waiting_for_approval")) {
    return "WaitingForApproval";
  }

  if (nodes.some((node) => node.status === "waiting_for_user")) {
    return "WaitingForInput";
  }

  if (
    nodes.some(
      (node) =>
        node.status === "blocked" ||
        node.status === "failed" ||
        node.status === "degraded",
    )
  ) {
    return "Blocked";
  }

  if (
    taskStatus === task.status &&
    nodes.every((node) => isDoneStatus(node.status))
  ) {
    return "Completed";
  }

  return taskStatus;
}

export function stateViewForWorkspaceStatus(input: {
  taskStatus?: string | null;
  executionStatus?: string | null;
  operationStatus?: string | null;
  planStatus?: string | null;
  planGenerationStatus?: string | null;
  currentNodeId?: string | null;
  currentNodeLabel?: string | null;
  hasPlan?: boolean;
  hasAcceptedPlan?: boolean;
  isRunnable?: boolean;
  disabledReason?: string | null;
  scheduleStatus?: string | null;
  nodeStatus?: string | null;
}): WorkStateView {
  return deriveWorkStateView({
    ...input,
    executionStatus: input.executionStatus ?? input.nodeStatus ?? null,
  });
}

export function mapTaskWorkspaceStatus(
  status: string,
): TaskWorkspaceUserStatus {
  if (status === "degraded") return "blocked";
  const stateView = stateViewForWorkspaceStatus({
    taskStatus: status,
    nodeStatus: status,
  });
  if (
    stateView.state === "result_ready" ||
    stateView.state === "done" ||
    stateView.state === "cancelled"
  )
    return "completed";
  if (stateView.state === "running") return "running";
  if (stateView.state === "waiting_for_approval") return "approval-needed";
  if (stateView.state === "waiting_for_input") return "input-needed";
  if (stateView.state === "blocked" || stateView.state === "failed")
    return "blocked";
  return "waiting";
}

export function overviewToneForNode(
  node: PlanNodeDataModel | null,
): ExecutionOverviewTone {
  if (!node) return "neutral";
  if (
    node.status === "blocked" ||
    node.status === "failed" ||
    node.status === "degraded"
  )
    return "critical";
  if (isAttentionStatus(node.status)) return "warning";
  if (isDoneStatus(node.status)) return "success";
  if (
    node.status === "active" ||
    node.status === "in_progress" ||
    node.status === "ready"
  )
    return "info";
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
  return mapTaskWorkspaceStatus(deriveWorkspaceWorkStateView(input).state);
}

export function deriveWorkspaceWorkStateView(input: {
  task: TaskData;
  progress: ProgressSummary;
  currentNode: PlanNodeDataModel | null;
}): WorkStateView {
  const planStatus = input.task.savedPlan?.status ?? null;
  return deriveWorkStateView({
    taskStatus: input.task.status,
    executionStatus:
      input.task.executionSummary?.executionState ??
      input.currentNode?.status ??
      null,
    planStatus,
    planGenerationStatus: input.task.aiPlanGenerationStatus ?? null,
    hasPlan: input.progress.totalSteps > 0 || Boolean(input.task.savedPlan),
    hasAcceptedPlan: planStatus === "accepted",
    isRunnable: input.task.isRunnable,
    disabledReason:
      input.task.runnabilityState === "blocked"
        ? input.task.runnabilitySummary
        : null,
    currentNodeId:
      input.currentNode?.id ??
      input.task.executionSummary?.currentNodeId ??
      null,
    currentNodeLabel: input.currentNode?.title ?? null,
    blockReason: input.task.blockReason,
  });
}

export function deriveHeaderActions(input: {
  task: TaskData;
  progress: ProgressSummary;
  workState: WorkStateView;
  copy: HeaderActionCopy;
}): TaskHeaderAction[] {
  const hasPlan =
    input.progress.totalSteps > 0 || Boolean(input.task.savedPlan);
  const hasUnacceptedSavedPlan = Boolean(
    input.task.savedPlan && input.task.savedPlan.status !== "accepted",
  );
  const cannotStartReason = !hasPlan
    ? input.copy.generateAndAcceptPlanBeforeStart
    : hasUnacceptedSavedPlan
      ? input.copy.acceptGeneratedPlanBeforeStart
      : !input.task.isRunnable
        ? input.task.runnabilitySummary
        : input.workState.state === "running"
          ? input.copy.taskAlreadyRunning
          : input.workState.state === "waiting_for_approval" ||
              input.workState.state === "waiting_for_input"
            ? input.copy.taskWaitingForCheckpointInput
            : input.workState.state === "blocked" ||
                input.workState.state === "failed"
              ? input.copy.resolveBlockerBeforeStart
              : input.workState.state === "result_ready" ||
                  input.workState.state === "done" ||
                  input.workState.state === "cancelled"
                ? input.copy.taskCompleted
                : undefined;

  return [
    {
      id: "start",
      label: input.copy.start,
      disabled: Boolean(cannotStartReason),
      disabledReason: cannotStartReason,
    },
    ...(input.workState.canPause
      ? [{ id: "pause" as const, label: input.copy.pause }]
      : []),
    ...(input.workState.canStop
      ? [{ id: "stop" as const, label: input.copy.stop }]
      : []),
    { id: "more", label: input.copy.moreActions },
  ];
}

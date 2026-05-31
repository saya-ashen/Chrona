import { api } from "@/lib/rpc-client";
import { appendTaskPrimaryNodeAction, graphNodeIdForTaskAction } from "@/components/tasks/plan/task-action-node-action";
import { stringifyResultOutput } from "@/components/tasks/plan/task-plan-graph/result-output-format";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { ExecutionActionInput, PlanExecutionResult, SubmitCheckpointActionInput, TaskPlanGenerationSessionReadModel } from "@chrona/contracts/ai";
import type {
  ExecutionOverviewCard,
  ExecutionOverviewTone,
  ProgressSummary,
  TaskData,
  TaskHeaderView,
  TaskPageData,
  TaskPlanGenerationStatus,
  TaskWorkspaceUserStatus,
  TaskWorkspaceExecutionConsoleView,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "./task-workspace-types";
import {
  activityToneFromOverviewTone,
  mergeWorkspaceActivity,
} from "./task-workspace-activity";
import {
  buildWorkspaceStateTreatment,
  type WorkspaceStateTreatmentCopy,
} from "./task-workspace-actions";

export type TaskWorkspaceCommandAck = {
  commandId: string;
  taskId: string;
  acceptedAt: string;
  message: string;
};
export type TaskExecutionDispatchResult = TaskWorkspaceCommandAck;
export type TaskCheckpointActionDispatchResult = TaskWorkspaceCommandAck;

export type TaskPlanState = {
  taskId: string;
  aiPlanGenerationStatus: TaskPlanGenerationStatus;
  savedPlan: TaskData["savedPlan"] | null;
  generationSession: TaskPlanGenerationSessionReadModel | null;
};

export type TaskWorkspaceExecutionConsoleCopy = WorkspaceStateTreatmentCopy & {
  noPlanYet: string;
  stepsComplete: string;
  latestResult: string;
  latestRun: string;
  runIsStatus: string;
  reviewResultActions: string;
  reviewRunContext: string;
  noExecutionResultYet: string;
  needsHandling: string;
  resolveInNodePanel: string;
  openActionControls: string;
  blocked: string;
  readyToSchedule: string;
  executionReadiness: string;
  currentWork: string;
  openRetryControls: string;
  openRunControls: string;
  noAcceptedPlanReady: string;
  noPlanNodeSelected: string;
  nodeDetailEmptyDescription: string;
  noActionsAvailableForNode: string;
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

export const DEFAULT_TASK_WORKSPACE_EXECUTION_CONSOLE_COPY: TaskWorkspaceExecutionConsoleCopy = {
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
  noPlanYet: "No plan yet",
  stepsComplete: "{completed}/{total} steps complete",
  latestResult: "Latest result",
  latestRun: "Latest run",
  runIsStatus: "Run is {status}",
  reviewResultActions: "Review result actions",
  reviewRunContext: "Review run context",
  noExecutionResultYet: "No execution result yet.",
  needsHandling: "Needs handling",
  resolveInNodePanel: "Resolve in node panel",
  openActionControls: "Open action controls",
  blocked: "Blocked",
  readyToSchedule: "Ready to schedule",
  executionReadiness: "Execution readiness",
  currentWork: "Current work",
  openRetryControls: "Open retry controls",
  openRunControls: "Open run controls",
  noAcceptedPlanReady: "No accepted plan is ready to run yet.",
  noPlanNodeSelected: "No plan node selected",
  nodeDetailEmptyDescription: "Generate or select a plan node to inspect execution details.",
  noActionsAvailableForNode: "No actions are available for this node.",
  generateAndAcceptPlanBeforeStart: "Generate and accept a plan before starting execution.",
  acceptGeneratedPlanBeforeStart: "Accept the generated plan before starting execution.",
  taskAlreadyRunning: "Task is already running.",
  taskWaitingForCheckpointInput: "Task is waiting for checkpoint input.",
  resolveBlockerBeforeStart: "Resolve the blocker before starting execution.",
  taskCompleted: "Task is completed.",
  noRunningExecutionToStop: "No running execution session to stop.",
  noRunningExecutionToPause: "No running execution session to pause.",
  start: "Start",
  pause: "Pause",
  stop: "Stop",
  moreActions: "More actions",
};

function resolveExecutionConsoleCopy(copy?: Partial<TaskWorkspaceExecutionConsoleCopy>) {
  return { ...DEFAULT_TASK_WORKSPACE_EXECUTION_CONSOLE_COPY, ...copy };
}

function fillTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

export const taskWorkspaceQueryKeys = {
  all: ["task-workspace"] as const,
  page: (taskId: string) => [...taskWorkspaceQueryKeys.all, "page", taskId] as const,
  planState: (taskId: string) => [...taskWorkspaceQueryKeys.all, "plan-state", taskId] as const,
  currentExecution: (taskId: string) => [...taskWorkspaceQueryKeys.all, "current-execution", taskId] as const,
};

function isDoneStatus(status: PlanNodeDataModel["status"]) {
  return status === "done" || status === "completed" || status === "skipped" || status === "cancelled" || status === "invalidated";
}

function isAttentionStatus(status: PlanNodeDataModel["status"]) {
  return status === "waiting"
    || status === "waiting_for_user"
    || status === "waiting_for_approval"
    || status === "blocked"
    || status === "failed"
    || status === "degraded";
}

function isCheckpointStatus(status: PlanNodeDataModel["status"]) {
  return status === "waiting" || status === "waiting_for_user" || status === "waiting_for_approval";
}

function deriveTaskStatusFromGraph(
  taskStatus: string,
  graphPlan: TaskPlanGraphPlan | null,
) {
  const nodes = graphPlan?.nodes ?? [];
  if (nodes.length === 0) return taskStatus;

  if (nodes.some((node) => node.status === "active" || node.status === "in_progress")) {
    return "Running";
  }

  if (nodes.some((node) => node.status === "waiting_for_user" || node.status === "waiting_for_approval")) {
    return "WaitingForInput";
  }

  if (nodes.some((node) => node.status === "blocked" || node.status === "failed" || node.status === "degraded")) {
    return "Blocked";
  }

  if (nodes.every((node) => isDoneStatus(node.status))) {
    return "Completed";
  }

  return taskStatus;
}

export function mapTaskWorkspaceStatus(status: string): TaskWorkspaceUserStatus {
  if (["done", "completed", "skipped", "cancelled", "invalidated", "Done", "Completed", "Cancelled"].includes(status)) return "completed";
  if (["active", "in_progress", "running", "Running"].includes(status)) return "running";
  if (["waiting_for_user", "waiting_for_approval", "WaitingForInput", "WaitingForApproval"].includes(status)) return "approval-needed";
  if (["blocked", "failed", "degraded", "Blocked", "Failed", "Degraded"].includes(status)) return "blocked";
  return "waiting";
}

export function isTaskWorkspaceAttentionStatus(status: PlanNodeDataModel["status"]) {
  return isAttentionStatus(status);
}

function overviewToneForNode(node: PlanNodeDataModel | null): ExecutionOverviewTone {
  if (!node) return "neutral";
  if (node.status === "blocked" || node.status === "failed" || node.status === "degraded") return "critical";
  if (isAttentionStatus(node.status)) return "warning";
  if (isDoneStatus(node.status)) return "success";
  if (node.status === "active" || node.status === "in_progress" || node.status === "ready") return "info";
  return "neutral";
}

export function buildProgressSummary(
  graphPlan: TaskPlanGraphPlan | null,
  copyInput?: Partial<Pick<TaskWorkspaceExecutionConsoleCopy, "noPlanYet" | "stepsComplete">>,
): ProgressSummary {
  const copy = resolveExecutionConsoleCopy(copyInput);
  const nodes = graphPlan?.nodes ?? [];
  const totalSteps = nodes.length;
  const completedSteps = nodes.filter((node) => isDoneStatus(node.status)).length;
  const percentComplete = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

  return {
    completedSteps,
    totalSteps,
    percentComplete,
    label: totalSteps === 0 ? copy.noPlanYet : fillTemplate(copy.stepsComplete, { completed: completedSteps, total: totalSteps }),
  };
}

export function pickWorkspaceCurrentNode(
  graphPlan: TaskPlanGraphPlan | null,
  selectedNode: PlanNodeDataModel | null = null,
) {
  const nodes = graphPlan?.nodes ?? [];
  return selectedNode
    ?? nodes.find((node) => node.id === graphPlan?.currentStepId)
    ?? nodes.find((node) => node.status === "active" || node.status === "in_progress")
    ?? nodes.find((node) => isAttentionStatus(node.status))
    ?? nodes.find((node) => node.status === "ready")
    ?? nodes[0]
    ?? null;
}

function nodeResultSummary(node: PlanNodeDataModel) {
  return node.completionSummary
    ?? node.result?.outputSummary
    ?? (node.resultOutputs ?? []).map(stringifyResultOutput).find((value) => value.trim())
    ?? null;
}

function nodeResultContent(node: PlanNodeDataModel) {
  const parts = [
    node.result?.outputSummary,
    node.completionSummary,
    ...(node.resultOutputs ?? []).map(stringifyResultOutput),
  ].filter((value): value is string => Boolean(value?.trim()));

  return Array.from(new Set(parts)).join("\n\n");
}

function pickLatestResultNode(graphPlan: TaskPlanGraphPlan | null) {
  return [...(graphPlan?.steps ?? graphPlan?.nodes ?? [])]
    .reverse()
    .find((node) => nodeResultSummary(node))
    ?? null;
}

function buildLatestResultCard(
  pageData: TaskPageData,
  graphPlan: TaskPlanGraphPlan | null,
  copy: TaskWorkspaceExecutionConsoleCopy,
): ExecutionOverviewCard {
  const latestResultNode = pickLatestResultNode(graphPlan);
  const nodeSummary = latestResultNode ? nodeResultSummary(latestResultNode) : null;

  if (nodeSummary) {
    return {
      id: `node-result-${latestResultNode?.id ?? "current"}`,
      title: copy.latestResult,
      description: nodeSummary,
      content: latestResultNode ? nodeResultContent(latestResultNode) : undefined,
      statusLabel: latestResultNode?.statusLabel ?? latestResultNode?.status,
      tone: overviewToneForNode(latestResultNode),
      actionLabel: copy.reviewResultActions,
      actionNodeId: latestResultNode?.id,
    };
  }

  if (pageData.latestRunSummary) {
    return {
      id: `run-${pageData.latestRunSummary.id}`,
      title: copy.latestRun,
      description: fillTemplate(copy.runIsStatus, { status: pageData.latestRunSummary.status }),
      statusLabel: pageData.latestRunSummary.syncStatus,
      tone: pageData.latestRunSummary.status === "Completed" ? "success" : "info",
      actionLabel: copy.reviewRunContext,
    };
  }

  return {
    id: "latest-result-empty",
    title: copy.latestResult,
    description: copy.noExecutionResultYet,
    tone: "neutral",
  };
}

function buildAttentionCard(
  pageData: TaskPageData,
  currentNode: PlanNodeDataModel | null,
  copy: TaskWorkspaceExecutionConsoleCopy,
): ExecutionOverviewCard | null {
  const pendingApproval = pageData.approvals.find((approval) => approval.status !== "Approved" && approval.status !== "Rejected");
  if (pendingApproval) {
    return {
      id: `approval-${pendingApproval.id}`,
      title: copy.needsHandling,
      description: pendingApproval.title,
      statusLabel: pendingApproval.status,
      tone: "warning",
      actionLabel: copy.resolveInNodePanel,
      actionNodeId: currentNode?.id,
    };
  }

  if (currentNode && isCheckpointStatus(currentNode.status)) {
    return {
      id: `node-attention-${currentNode.id}`,
      title: copy.needsHandling,
      description: currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: copy.openActionControls,
      actionNodeId: currentNode.id,
    };
  }

  if (pageData.task.blockReason) {
    const actionNodeId = graphNodeIdForTaskAction(
      pageData.task.executionSummary?.primaryAction,
      pageData,
      null,
    ) ?? currentNode?.id;
    return {
      id: "task-block-reason",
      title: copy.blocked,
      description: pageData.task.blockReason.actionRequired ?? pageData.task.runnabilitySummary,
      statusLabel: pageData.task.blockReason.blockType,
      tone: "critical",
      actionLabel: actionNodeId ? copy.openActionControls : undefined,
      actionNodeId: actionNodeId ?? undefined,
    };
  }

  if (currentNode && isAttentionStatus(currentNode.status)) {
    return {
      id: `node-attention-${currentNode.id}`,
      title: copy.needsHandling,
      description: currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: copy.openActionControls,
      actionNodeId: currentNode.id,
    };
  }

  return null;
}

function buildReadinessCard(
  pageData: TaskPageData,
  currentNode: PlanNodeDataModel | null,
  copy: TaskWorkspaceExecutionConsoleCopy,
): ExecutionOverviewCard {
  const pendingProposal = pageData.scheduleProposals.find((proposal) => proposal.status === "Pending");
  if (pendingProposal) {
    return {
      id: `schedule-proposal-${pendingProposal.id}`,
      title: copy.readyToSchedule,
      description: pendingProposal.summary,
      statusLabel: pendingProposal.status,
      tone: "warning",
    };
  }

  if (!pageData.task.isRunnable) {
    return {
      id: "task-not-runnable",
      title: copy.executionReadiness,
      description: pageData.task.runnabilitySummary,
      statusLabel: pageData.task.runnabilityState ?? pageData.task.scheduleStatus,
      tone: "warning",
    };
  }

  if (currentNode) {
    return {
      id: `current-node-${currentNode.id}`,
      title: copy.currentWork,
      description: currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: currentNode.status === "blocked" ? copy.openRetryControls : copy.openRunControls,
      actionNodeId: currentNode.id,
    };
  }

  return {
    id: "execution-ready-empty",
    title: copy.executionReadiness,
    description: pageData.task.scheduleStatus === "Unscheduled"
      ? copy.noAcceptedPlanReady
      : pageData.task.runnabilitySummary,
    statusLabel: pageData.task.scheduleStatus,
    tone: pageData.task.scheduleStatus === "Unscheduled" ? "neutral" : "info",
  };
}

function buildArtifactItems(pageData: TaskPageData, graphPlan: TaskPlanGraphPlan | null): WorkspaceArtifactItem[] {
  const nodeArtifacts = (graphPlan?.nodes ?? []).flatMap((node) => (node.resultOutputs ?? []).map((output, index) => ({
    id: `${node.id}-output-${index}`,
    title: `${node.title} output ${index + 1}`,
    type: output.kind,
    sourceNodeId: node.id,
    content: stringifyResultOutput(output),
  })));

  return [
    ...nodeArtifacts,
    ...pageData.artifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      type: artifact.type,
      uri: artifact.uri,
    })),
  ];
}

function buildActivity(pageData: TaskPageData, graphPlan: TaskPlanGraphPlan | null): WorkspaceActivityItem[] {
  const providerActivity = pageData.activityTimeline ?? [];
  const approvalActivity = pageData.approvals.slice(0, 3).map((approval) => ({
    id: `approval-${approval.id}`,
    kind: "approval" as const,
    title: approval.title,
    summary: `Approval ${approval.status}`,
    description: `Approval ${approval.status}`,
    tone: approval.status === "Approved" || approval.status === "EditedAndApproved" ? "success" as const : "warning" as const,
    timestamp: approval.requestedAt,
  }));

  const artifactActivity = pageData.artifacts.slice(0, 3).map((artifact) => ({
    id: `artifact-${artifact.id}`,
    kind: "artifact" as const,
    title: artifact.title,
    summary: `Artifact ${artifact.type}`,
    description: `Artifact ${artifact.type}`,
    tone: "info" as const,
  }));

  const proposalActivity = pageData.scheduleProposals
    .filter((proposal) => proposal.status === "Pending")
    .slice(0, 2)
    .map((proposal) => ({
      id: `schedule-proposal-${proposal.id}`,
      kind: "schedule" as const,
      title: "Schedule proposal",
      summary: proposal.summary,
      description: proposal.summary,
      tone: "warning" as const,
      timestamp: proposal.scheduledStartAt,
    }));

  const nodeActivity = (graphPlan?.nodes ?? [])
    .filter((node) => node.status !== "idle" && node.status !== "pending")
    .slice(0, 5)
    .map((node) => ({
      id: `node-${node.id}`,
      kind: "node" as const,
      title: node.title,
      summary: node.statusLabel ?? node.status,
      description: node.statusLabel ?? node.status,
      tone: activityToneFromOverviewTone(overviewToneForNode(node)),
      sourceNodeId: node.id,
      sourceNodeTitle: node.title,
    }));

  const fallbackActivity = [...approvalActivity, ...artifactActivity, ...proposalActivity, ...nodeActivity] satisfies WorkspaceActivityItem[];

  if (pageData.latestRunSummary) {
    return mergeWorkspaceActivity([...providerActivity, {
      id: `run-${pageData.latestRunSummary.id}`,
      kind: "provider_run" as const,
      title: "Latest run",
      summary: pageData.latestRunSummary.status,
      description: pageData.latestRunSummary.status,
      tone: pageData.latestRunSummary.status === "Completed" ? "success" as const : "info" as const,
      timestamp: pageData.latestRunSummary.startedAt,
    }, ...fallbackActivity]);
  }

  return mergeWorkspaceActivity([...providerActivity, ...fallbackActivity]);
}

function buildTaskHeaderView(
  pageData: TaskPageData,
  progress: ProgressSummary,
  currentNode: PlanNodeDataModel | null,
  copy: TaskWorkspaceExecutionConsoleCopy,
): TaskHeaderView {
  const allNodesDone = progress.totalSteps > 0 && progress.completedSteps === progress.totalSteps;
  const currentNodeStatus = !allNodesDone && currentNode && isAttentionStatus(currentNode.status)
    ? mapTaskWorkspaceStatus(currentNode.status)
    : null;
  const workspaceStatus = currentNodeStatus ?? (pageData.task.executionSummary
    ? mapTaskWorkspaceStatus(pageData.task.executionSummary.executionState)
    : mapTaskWorkspaceStatus(pageData.task.status));
  const hasPlan = progress.totalSteps > 0 || Boolean(pageData.task.savedPlan);
  const hasUnacceptedSavedPlan = Boolean(pageData.task.savedPlan && pageData.task.savedPlan.status !== "accepted");
  const cannotStartReason = !hasPlan
    ? copy.generateAndAcceptPlanBeforeStart
    : hasUnacceptedSavedPlan
      ? copy.acceptGeneratedPlanBeforeStart
    : !pageData.task.isRunnable
      ? pageData.task.runnabilitySummary
    : workspaceStatus === "running"
        ? copy.taskAlreadyRunning
        : workspaceStatus === "approval-needed"
          ? copy.taskWaitingForCheckpointInput
          : workspaceStatus === "blocked"
            ? copy.resolveBlockerBeforeStart
            : workspaceStatus === "completed"
              ? copy.taskCompleted
              : undefined;
  const cannotStopReason = workspaceStatus === "running" || workspaceStatus === "approval-needed"
    ? undefined
    : copy.noRunningExecutionToStop;
  const cannotPauseReason = workspaceStatus === "running"
    ? undefined
    : copy.noRunningExecutionToPause;

  return {
    title: pageData.task.title,
    canEditTitle: true,
    status: workspaceStatus,
    completedSteps: progress.completedSteps,
    totalSteps: progress.totalSteps,
    progressPercent: progress.percentComplete,
    actions: [
      { id: "start", label: copy.start, disabled: Boolean(cannotStartReason), disabledReason: cannotStartReason },
      { id: "pause", label: copy.pause, disabled: Boolean(cannotPauseReason), disabledReason: cannotPauseReason },
      { id: "stop", label: copy.stop, disabled: Boolean(cannotStopReason), disabledReason: cannotStopReason },
      { id: "more", label: copy.moreActions },
    ],
    primaryStateLabel: pageData.task.executionSummary?.stateLabel,
    primaryActionLabel: pageData.task.executionSummary?.primaryAction.label ?? null,
    currentNodeId: pageData.task.executionSummary?.currentNodeId ?? null,
  };
}

export function createTaskWorkspaceExecutionConsoleView(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  selectedNode?: PlanNodeDataModel | null;
  copy?: Partial<TaskWorkspaceExecutionConsoleCopy>;
}): TaskWorkspaceExecutionConsoleView {
  const copy = resolveExecutionConsoleCopy(input.copy);
  const graphPlan = appendTaskPrimaryNodeAction(input.pageData, input.graphPlan);
  const task = {
    ...input.pageData.task,
    status: deriveTaskStatusFromGraph(input.pageData.task.status, graphPlan),
  } satisfies TaskData;
  const pageData = { ...input.pageData, task } satisfies TaskPageData;
  const selectedNode = input.selectedNode
    ? graphPlan?.nodes.find((node) => node.id === input.selectedNode?.id) ?? input.selectedNode
    : null;
  const currentNode = pickWorkspaceCurrentNode(graphPlan, selectedNode);
  const progress = buildProgressSummary(graphPlan, copy);
  const attention = buildAttentionCard(pageData, currentNode, copy);
  const isPermissionLimited = !pageData.task.isRunnable && !pageData.task.blockReason;
  const isStale = pageData.latestRunSummary?.syncStatus === "stale";
  const errorMessage = graphPlan?.state === "empty" && pageData.task.status === "Failed" ? pageData.task.runnabilitySummary : null;
  const activity = buildActivity(pageData, graphPlan);

  return {
    task,
    header: buildTaskHeaderView(pageData, progress, currentNode, copy),
    graphPlan,
    progress,
    nodeDetail: {
      selectedNode,
      currentNode,
      title: currentNode?.title ?? copy.noPlanNodeSelected,
      description: currentNode?.summary ?? currentNode?.objective ?? copy.nodeDetailEmptyDescription,
      status: currentNode ? mapTaskWorkspaceStatus(currentNode.status) : null,
      stepPosition: currentNode ? `${(graphPlan?.nodes ?? []).findIndex((node) => node.id === currentNode.id) + 1}/${graphPlan?.nodes.length ?? 0}` : "0/0",
      autoRefreshEnabled: currentNode ? ["running", "approval-needed"].includes(mapTaskWorkspaceStatus(currentNode.status)) : false,
      tabs: ["result", "activity", "action", "configuration"],
      disabledActionReason:
        Boolean(currentNode) &&
        (currentNode.availableActions?.length ?? 0) === 0 &&
        (currentNode.interactiveFields?.length ?? 0) === 0
          ? copy.noActionsAvailableForNode
          : undefined,
      isEmpty: !currentNode,
    },
    readiness: buildReadinessCard(pageData, currentNode, copy),
    latestResult: buildLatestResultCard(pageData, graphPlan, copy),
    attention,
    artifacts: buildArtifactItems(pageData, graphPlan),
    activity,
    states: {
      isEmpty: (graphPlan?.nodes.length ?? 0) === 0,
      isStale,
      isPermissionLimited,
      errorMessage,
      treatment: buildWorkspaceStateTreatment({
        currentNode,
        hasPlan: (graphPlan?.nodes.length ?? 0) > 0,
        allNodesDone: Boolean(graphPlan?.nodes.length) && Boolean(graphPlan?.nodes.every((node) => isDoneStatus(node.status))),
        isBlocked: Boolean(pageData.task.blockReason),
        isStale,
        isPermissionLimited,
        permissionSummary: pageData.task.runnabilitySummary,
        blockActionRequired: pageData.task.blockReason?.actionRequired,
        copy,
      }),
    },
  };
}

export async function fetchTaskWorkspacePage(taskId: string): Promise<TaskPageData> {
  const response = await api.tasks[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load task workspace" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load task workspace");
  }

  return await response.json() as unknown as TaskPageData;
}

export async function fetchTaskPlanState(taskId: string): Promise<TaskPlanState> {
  const response = await api.tasks[":taskId"].plan.$get({
    param: { taskId },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load task plan state" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load task plan state");
  }

  const payload = await response.json() as {
      taskId: string;
      aiPlanGenerationStatus?: string;
      savedPlan?: TaskData["savedPlan"] | null;
      generationSession?: TaskPlanGenerationSessionReadModel | null;
    };

  return {
    taskId: payload.taskId,
    aiPlanGenerationStatus: (payload.aiPlanGenerationStatus ?? "idle") as TaskPlanState["aiPlanGenerationStatus"],
    savedPlan: payload.savedPlan ?? null,
    generationSession: payload.generationSession ?? null,
  };
}

export async function fetchCurrentTaskExecution(taskId: string): Promise<PlanExecutionResult> {
  const response = await api.tasks[":taskId"].execution.current.$get({
    param: { taskId },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load current execution state" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load current execution state");
  }

  return await response.json() as unknown as PlanExecutionResult;
}

export async function dispatchTaskExecutionAction(
  taskId: string,
  action: ExecutionActionInput,
): Promise<TaskWorkspaceCommandAck> {
  const response = await api.work[":taskId"].commands.$post({
    param: { taskId },
    json: { type: "execution.action", ...action },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to dispatch execution action" }));
    throw new Error((err as { error?: string }).error ?? "Failed to dispatch execution action");
  }

  const ack = await response.json() as unknown as Omit<TaskWorkspaceCommandAck, "message">;
  return { ...ack, message: "Command accepted. Workspace will update shortly." };
}

export async function submitTaskCheckpointAction(
  taskId: string,
  action: SubmitCheckpointActionInput,
): Promise<TaskWorkspaceCommandAck> {
  const response = await api.work[":taskId"].commands.$post({
    param: { taskId },
    json: {
      type: "checkpoint.action",
      checkpointId: action.checkpointId,
      action: action.action,
      payload: action.payload as Record<string, unknown> | undefined,
      idempotencyKey: action.idempotencyKey,
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to submit checkpoint action" }));
    throw new Error((err as { error?: string }).error ?? "Failed to submit checkpoint action");
  }

  const ack = await response.json() as unknown as Omit<TaskWorkspaceCommandAck, "message">;
  return { ...ack, message: "Command accepted. Workspace will update shortly." };
}

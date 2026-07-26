import { apiJson } from "@shared/http";
import {
  appendTaskPrimaryNodeAction,
  graphNodeIdForTaskAction,
} from "../plan/task-action-node-action";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "./plan-node-view-model";
import type { ExecutionActionInput,
PlanExecutionResult,
SubmitCheckpointActionInput,
TaskPlanGenerationSessionReadModel, } from "@chrona/contracts"
import type {
  ExecutionOverviewCard,
  ProgressSummary,
  TaskData,
  TaskHeaderView,
  TaskPageData,
  TaskPlanGenerationStatus,
  TaskWorkspaceBootstrapData,
  TaskWorkspaceCommandCenterData,
  TaskWorkspaceReviewContextData,
  TaskWorkspaceRuntimeContextData,
  TaskWorkspaceExecutionConsoleView,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "./task-workspace-types";

import {
  deriveHeaderActions,
  deriveTaskStatusFromGraph,
  deriveWorkspaceWorkStateView,
  isAttentionStatus,
  isCheckpointStatus,
  isDoneStatus,
  mapTaskWorkspaceStatus,
  overviewToneForNode,
} from "./task-workspace-state";
import { mergeWorkspaceActivity } from "./task-workspace-activity";
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
export type TaskResultAcceptResult = {
  taskId: string;
  workspaceId: string;
  runId: string;
  acceptedAt: string;
};

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

export const DEFAULT_TASK_WORKSPACE_EXECUTION_CONSOLE_COPY: TaskWorkspaceExecutionConsoleCopy =
  {
    syncStaleLabel: "Sync stale",
    syncStaleGuidance: "Refresh before acting on execution results.",
    viewOnlyLabel: "View only",
    viewOnlyGuidance: "You can view this task, but cannot run it.",
    noPlanYetLabel: "No plan yet",
    noPlanYetGuidance:
      "Generate and accept a plan to unlock execution controls.",
    completedLabel: "Completed",
    completedGuidance:
      "Review the latest result and artifacts before closing the task.",
    degradedLabel: "Degraded",
    degradedGuidance:
      "Retry sync or repair this node before continuing execution.",
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
    nodeDetailEmptyDescription:
      "Generate or select a plan node to inspect execution details.",
    noActionsAvailableForNode: "No actions are available for this node.",
    generateAndAcceptPlanBeforeStart:
      "Generate and accept a plan before starting execution.",
    acceptGeneratedPlanBeforeStart:
      "Accept the generated plan before starting execution.",
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

function resolveExecutionConsoleCopy(
  copy?: Partial<TaskWorkspaceExecutionConsoleCopy>,
) {
  return { ...DEFAULT_TASK_WORKSPACE_EXECUTION_CONSOLE_COPY, ...copy };
}

function fillTemplate(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

export const taskWorkspaceQueryKeys = {
  all: ["task-workspace"] as const,
  page: (taskId: string, workBlockId?: string | null) =>
    [
      ...taskWorkspaceQueryKeys.all,
      "page",
      taskId,
      workBlockId ?? null,
    ] as const,
  planState: (taskId: string, workBlockId?: string | null) =>
    [
      ...taskWorkspaceQueryKeys.all,
      "plan-state",
      taskId,
      workBlockId ?? null,
    ] as const,
  currentExecution: (taskId: string, workBlockId?: string | null) =>
    [
      ...taskWorkspaceQueryKeys.all,
      "current-execution",
      taskId,
      workBlockId ?? null,
    ] as const,
};

export const commandCenterQueryKeys = {
  all: ["task-workspace", "command-center"] as const,
  detail: (taskId: string, workBlockId?: string | null) =>
    [...commandCenterQueryKeys.all, taskId, workBlockId ?? null] as const,
};
export {
  isAttentionStatus as isTaskWorkspaceAttentionStatus,
  mapTaskWorkspaceStatus,
} from "./task-workspace-state";

export function buildProgressSummary(
  graphPlan: TaskPlanGraphPlan | null,
  copyInput?: Partial<
    Pick<TaskWorkspaceExecutionConsoleCopy, "noPlanYet" | "stepsComplete">
  >,
): ProgressSummary {
  const copy = resolveExecutionConsoleCopy(copyInput);
  const nodes = graphPlan?.nodes ?? [];
  const totalSteps = nodes.length;
  const completedSteps = nodes.filter((node) =>
    isDoneStatus(node.status),
  ).length;
  const percentComplete =
    totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

  return {
    completedSteps,
    totalSteps,
    percentComplete,
    label:
      totalSteps === 0
        ? copy.noPlanYet
        : fillTemplate(copy.stepsComplete, {
            completed: completedSteps,
            total: totalSteps,
          }),
  };
}

export function pickWorkspaceCurrentNode(
  graphPlan: TaskPlanGraphPlan | null,
  selectedNode: PlanNodeDataModel | null = null,
) {
  const nodes = graphPlan?.nodes ?? [];
  return (
    selectedNode ??
    nodes.find((node) => node.id === graphPlan?.currentStepId) ??
    nodes.find(
      (node) => node.status === "active" || node.status === "in_progress",
    ) ??
    nodes.find((node) => isAttentionStatus(node.status)) ??
    nodes.find((node) => node.status === "ready") ??
    nodes[0] ??
    null
  );
}

function nodeResultSummary(node: PlanNodeDataModel) {
  return node.completionSummary ?? null;
}

function pickLatestResultNode(graphPlan: TaskPlanGraphPlan | null) {
  return (
    [...(graphPlan?.steps ?? graphPlan?.nodes ?? [])]
      .reverse()
      .find((node) => nodeResultSummary(node)) ?? null
  );
}

function buildLatestResultCard(
  pageData: TaskPageData,
  graphPlan: TaskPlanGraphPlan | null,
  copy: TaskWorkspaceExecutionConsoleCopy,
): ExecutionOverviewCard {
  const latestResultNode = pickLatestResultNode(graphPlan);
  const nodeSummary = latestResultNode
    ? nodeResultSummary(latestResultNode)
    : null;

  if (nodeSummary) {
    return {
      id: `node-result-${latestResultNode?.id ?? "current"}`,
      title: copy.latestResult,
      description: nodeSummary,
      summary: nodeSummary,
      statusLabel: latestResultNode?.statusLabel ?? latestResultNode?.status,
      tone: overviewToneForNode(latestResultNode),
      actionLabel: copy.reviewResultActions,
      ctaLabel: copy.reviewResultActions,
      actionNodeId: latestResultNode?.id,
      sourceNodeTitle: latestResultNode?.title,
    };
  }

  if (pageData.latestRunSummary) {
    return {
      id: `run-${pageData.latestRunSummary.id}`,
      title: copy.latestRun,
      description: fillTemplate(copy.runIsStatus, {
        status:
          pageData.latestRunSummary.displayStatus ??
          pageData.latestRunSummary.status,
      }),
      statusLabel: pageData.latestRunSummary.syncStatus,
      tone:
        (pageData.latestRunSummary.displayStatus ??
          pageData.latestRunSummary.status) === "Completed"
          ? "success"
          : "info",
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
  const pendingApproval = pageData.approvals.find(
    (approval) =>
      approval.status !== "Approved" && approval.status !== "Rejected",
  );
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
      description:
        currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: copy.openActionControls,
      actionNodeId: currentNode.id,
    };
  }

  if (pageData.task.blockReason) {
    const actionNodeId =
      graphNodeIdForTaskAction(
        pageData.task.executionSummary?.primaryAction,
        pageData,
        null,
      ) ?? currentNode?.id;
    // Prefer the agent-supplied actionForm.instructions over the generic outcome message.
    const blockInstructions =
      currentNode?.status === "blocked"
        ? (currentNode.result?.actionForm?.instructions ?? null)
        : null;
    return {
      id: "task-block-reason",
      title: copy.blocked,
      description:
        blockInstructions ??
        pageData.task.blockReason.detail ??
        pageData.task.blockReason.actionRequired ??
        pageData.task.runnabilitySummary,
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
      description:
        currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
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
  const pendingProposal = pageData.scheduleProposals.find(
    (proposal) => proposal.status === "Pending",
  );
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
      statusLabel:
        pageData.task.runnabilityState ?? pageData.task.scheduleStatus,
      tone: "warning",
    };
  }

  if (currentNode) {
    return {
      id: `current-node-${currentNode.id}`,
      title: copy.currentWork,
      description:
        currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel:
        currentNode.status === "blocked"
          ? copy.openRetryControls
          : copy.openRunControls,
      actionNodeId: currentNode.id,
    };
  }

  return {
    id: "execution-ready-empty",
    title: copy.executionReadiness,
    description:
      pageData.task.scheduleStatus === "Unscheduled"
        ? copy.noAcceptedPlanReady
        : pageData.task.runnabilitySummary,
    statusLabel: pageData.task.scheduleStatus,
    tone: pageData.task.scheduleStatus === "Unscheduled" ? "neutral" : "info",
  };
}

function buildArtifactItems(
  pageData: TaskPageData,
  _graphPlan: TaskPlanGraphPlan | null,
): WorkspaceArtifactItem[] {
  return pageData.artifacts.map((artifact) => ({
    id: artifact.id,
    artifactRef: artifact.artifactRef,
    title: artifact.title,
    type: artifact.type,
    uri: artifact.uri,
  }));
}

function buildActivity(pageData: TaskPageData): WorkspaceActivityItem[] {
  return mergeWorkspaceActivity(pageData.activityTimeline ?? []);
}

function buildTaskHeaderView(
  pageData: TaskPageData,
  progress: ProgressSummary,
  currentNode: PlanNodeDataModel | null,
  copy: TaskWorkspaceExecutionConsoleCopy,
): TaskHeaderView {
  const workState = deriveWorkspaceWorkStateView({
    task: pageData.task,
    progress,
    currentNode,
  });
  const actions = deriveHeaderActions({
    task: pageData.task,
    progress,
    workState,
    copy,
  });
  const headerActions = actions.flatMap((action) => action.id === "more"
    ? [
        ...(actions.some((candidate) => candidate.id === "pause") ? [] : [{ id: "pause" as const, label: copy.pause, disabled: true, disabledReason: copy.noRunningExecutionToPause }]),
        ...(actions.some((candidate) => candidate.id === "stop") ? [] : [{ id: "stop" as const, label: copy.stop, disabled: true, disabledReason: copy.noRunningExecutionToStop }]),
        action,
      ]
    : [action]);

  return {
    title: pageData.task.title,
    canEditTitle: true,
    status: mapTaskWorkspaceStatus(workState.state),
    completedSteps: workState.showLiveProgress ? progress.completedSteps : 0,
    totalSteps: workState.showLiveProgress ? progress.totalSteps : 0,
    progressPercent: workState.showLiveProgress ? progress.percentComplete : 0,
    actions: headerActions,
    primaryStateLabel: pageData.task.executionSummary?.stateLabel ?? workState.label,
    primaryActionLabel: pageData.task.executionSummary?.primaryAction.label ?? workState.nextActionLabel,
    currentNodeId: pageData.task.executionSummary?.currentNodeId ?? workState.currentNodeId,
  };
}

export function createTaskWorkspaceExecutionConsoleView(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  selectedNode?: PlanNodeDataModel | null;
  copy?: Partial<TaskWorkspaceExecutionConsoleCopy>;
}): TaskWorkspaceExecutionConsoleView {
  const copy = resolveExecutionConsoleCopy(input.copy);
  const graphPlan = appendTaskPrimaryNodeAction(
    input.pageData,
    input.graphPlan,
  );
  const task = {
    ...input.pageData.task,
    status: deriveTaskStatusFromGraph(input.pageData.task, graphPlan),
  } satisfies TaskData;
  const pageData = { ...input.pageData, task } satisfies TaskPageData;
  const selectedNode = input.selectedNode
    ? (graphPlan?.nodes.find((node) => node.id === input.selectedNode?.id) ??
      input.selectedNode)
    : null;
  const currentNode = pickWorkspaceCurrentNode(graphPlan, selectedNode);
  const progress = buildProgressSummary(graphPlan, copy);
  const attention = buildAttentionCard(pageData, currentNode, copy);
  const latestCompletedNode = pickLatestResultNode(graphPlan);
  const isPermissionLimited =
    !pageData.task.isRunnable && !pageData.task.blockReason;
  const isStale = pageData.latestRunSummary?.syncStatus === "stale";
  const errorMessage =
    graphPlan?.state === "empty" && pageData.task.status === "Failed"
      ? pageData.task.runnabilitySummary
      : null;
  const activity = buildActivity(pageData);

  return {
    task,
    header: buildTaskHeaderView(pageData, progress, currentNode, copy),
    graphPlan,
    progress,
    nodeDetail: {
      selectedNode,
      currentNode,
      title: currentNode?.title ?? copy.noPlanNodeSelected,
      description:
        currentNode?.summary ??
        currentNode?.objective ??
        copy.nodeDetailEmptyDescription,
      status: currentNode ? mapTaskWorkspaceStatus(currentNode.status) : null,
      stepPosition: currentNode
        ? `${(graphPlan?.nodes ?? []).findIndex((node) => node.id === currentNode.id) + 1}/${graphPlan?.nodes.length ?? 0}`
        : "0/0",
      autoRefreshEnabled: currentNode
        ? ["running", "input-needed", "approval-needed"].includes(
            mapTaskWorkspaceStatus(currentNode.status),
          )
        : false,
      tabs: ["result", "activity", "configuration"],
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
    latestCompletedNode,
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
        allNodesDone:
          Boolean(graphPlan?.nodes.length) &&
          Boolean(graphPlan?.nodes.every((node) => isDoneStatus(node.status))),
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

function taskScopedQuery(workBlockId?: string | null) {
  return workBlockId ? `?workBlockId=${encodeURIComponent(workBlockId)}` : "";
}

export async function fetchTaskWorkspacePage(
  taskId: string,
  workBlockId?: string | null,
): Promise<TaskPageData> {
  const taskPath = `/api/tasks/${encodeURIComponent(taskId)}`;
  const query = taskScopedQuery(workBlockId);
  const [bootstrap, runtimeContext, reviewContext] = await Promise.all([
    apiJson<TaskWorkspaceBootstrapData>(`${taskPath}${query}`),
    apiJson<TaskWorkspaceRuntimeContextData>(
      `${taskPath}/runtime-context${query}`,
    ),
    apiJson<TaskWorkspaceReviewContextData>(
      `${taskPath}/review-context${query}`,
    ),
  ]);

  return {
    ...bootstrap,
    ...runtimeContext,
    ...reviewContext,
    activityTimeline: [],
  };
}

/**
 * Fetch only the json-render command-center documents (now / output /
 * trail) for a task. Kept separate from {@link fetchTaskWorkspacePage} so
 * that the heavy page metadata query does not embed spec blobs.
 */
export async function fetchTaskCommandCenter(
  taskId: string,
  workBlockId?: string | null,
): Promise<TaskWorkspaceCommandCenterData> {
  const query = taskScopedQuery(workBlockId);
  return apiJson<TaskWorkspaceCommandCenterData>(
    `/api/tasks/${encodeURIComponent(taskId)}/command-center${query}`,
  );
}

export async function fetchTaskPlanState(
  taskId: string,
  workBlockId?: string | null,
): Promise<TaskPlanState> {
  const payload = await apiJson<{
    taskId: string;
    aiPlanGenerationStatus?: string;
    savedPlan?: TaskData["savedPlan"] | null;
    generationSession?: TaskPlanGenerationSessionReadModel | null;
  }>(`/api/tasks/${encodeURIComponent(taskId)}/plan${taskScopedQuery(workBlockId)}`);
  return {
    taskId: payload.taskId,
    aiPlanGenerationStatus: (payload.aiPlanGenerationStatus ?? "idle") as TaskPlanState["aiPlanGenerationStatus"],
    savedPlan: payload.savedPlan ?? null,
    generationSession: payload.generationSession ?? null,
  };
}

export function fetchCurrentTaskExecution(
  taskId: string,
  workBlockId?: string | null,
): Promise<PlanExecutionResult> {
  return apiJson<PlanExecutionResult>(
    `/api/tasks/${encodeURIComponent(taskId)}/execution/current${taskScopedQuery(workBlockId)}`,
  );
}

export async function dispatchTaskExecutionAction(
  taskId: string,
  action: ExecutionActionInput,
  workBlockId?: string | null,
): Promise<TaskWorkspaceCommandAck> {
  const scopedAction = workBlockId ? { ...action, workBlockId } : action;
  const ack = await apiJson<Omit<TaskWorkspaceCommandAck, "message">>(
    `/api/work/${encodeURIComponent(taskId)}/commands`,
    { method: "POST", body: JSON.stringify({ type: "execution.action", ...scopedAction }) },
  );
  return { ...ack, message: "Command accepted. Workspace will update shortly." };
}

export async function submitTaskCheckpointAction(
  taskId: string,
  action: SubmitCheckpointActionInput,
  workBlockId?: string | null,
): Promise<TaskWorkspaceCommandAck> {
  const scopedAction = workBlockId ? { ...action, workBlockId } : action;
  const ack = await apiJson<Omit<TaskWorkspaceCommandAck, "message">>(
    `/api/work/${encodeURIComponent(taskId)}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        type: "checkpoint.action",
        checkpointId: scopedAction.checkpointId,
        action: scopedAction.action,
        payload: scopedAction.payload as Record<string, unknown> | undefined,
        workBlockId: scopedAction.workBlockId ?? undefined,
        idempotencyKey: scopedAction.idempotencyKey,
      }),
    },
  );
  return { ...ack, message: "Command accepted. Workspace will update shortly." };
}

export async function acceptTaskResult(
  taskId: string,
): Promise<TaskResultAcceptResult> {
  return apiJson<TaskResultAcceptResult>(
    `/api/tasks/${encodeURIComponent(taskId)}/result/accept`,
    { method: "POST" },
  );
}

export async function retryTaskResultFinalization(taskId: string) {
  return apiJson<{
    taskId: string;
    finalization: NonNullable<PlanExecutionResult["planOutput"]>["finalization"];
    finalizedResult: NonNullable<PlanExecutionResult["planOutput"]>["finalizedResult"];
  }>(
    `/api/tasks/${encodeURIComponent(taskId)}/result/finalization/retry`,
    { method: "POST" },
  );
}

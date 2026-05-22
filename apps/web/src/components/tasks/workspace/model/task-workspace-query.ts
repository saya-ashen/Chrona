import { api } from "@/lib/rpc-client";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { ExecutionActionInput, NodeResultOutput, PlanExecutionResult, SubmitCheckpointActionInput, TaskPlanGenerationSessionReadModel } from "@chrona/contracts/ai";
import type {
  ExecutionOverviewCard,
  ExecutionFlowView,
  ExecutionOverviewTone,
  ProgressSummary,
  TaskData,
  TaskHeaderView,
  TaskPageData,
  TaskPlanGenerationStatus,
  TaskWorkspaceUserStatus,
  TaskWorkspaceExecutionConsoleView,
  WorkspaceNavigationView,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "./task-workspace-types";
import { buildWorkspaceStateTreatment } from "./task-workspace-actions";

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

function buildWorkspaceMemberContext(pageData: TaskPageData, hasAttention: boolean) {
  const notificationCount = pageData.approvals.filter((approval) => approval.status !== "Approved" && approval.status !== "Rejected").length
    + pageData.scheduleProposals.filter((proposal) => proposal.status === "Pending").length
    + (hasAttention ? 1 : 0);

  return {
    memberLabel: "Project member",
    notificationCount,
  };
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

export function buildProgressSummary(graphPlan: TaskPlanGraphPlan | null): ProgressSummary {
  const nodes = graphPlan?.nodes ?? [];
  const totalSteps = nodes.length;
  const completedSteps = nodes.filter((node) => isDoneStatus(node.status)).length;
  const percentComplete = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

  return {
    completedSteps,
    totalSteps,
    percentComplete,
    label: totalSteps === 0 ? "No plan yet" : `${completedSteps}/${totalSteps} steps complete`,
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
    ?? (node.resultOutputs ?? []).map(stringifyNodeResultOutput).find((value) => value.trim())
    ?? null;
}

function stringifyNodeResultOutput(output: NodeResultOutput) {
  if (output.kind === "text" || output.kind === "markdown") return output.content;
  if (output.kind === "json") return JSON.stringify(output.value, null, 2);
  if (output.kind === "file") return [output.title, output.path, output.description].filter(Boolean).join("\n");
  return "";
}

function nodeResultContent(node: PlanNodeDataModel) {
  const parts = [
    node.result?.outputSummary,
    node.completionSummary,
    ...(node.resultOutputs ?? []).map(stringifyNodeResultOutput),
  ].filter((value): value is string => Boolean(value?.trim()));

  return Array.from(new Set(parts)).join("\n\n");
}

function pickLatestResultNode(graphPlan: TaskPlanGraphPlan | null) {
  return [...(graphPlan?.steps ?? graphPlan?.nodes ?? [])]
    .reverse()
    .find((node) => nodeResultSummary(node))
    ?? null;
}

function buildLatestResultCard(pageData: TaskPageData, graphPlan: TaskPlanGraphPlan | null): ExecutionOverviewCard {
  const latestResultNode = pickLatestResultNode(graphPlan);
  const nodeSummary = latestResultNode ? nodeResultSummary(latestResultNode) : null;

  if (nodeSummary) {
    return {
      id: `node-result-${latestResultNode?.id ?? "current"}`,
      title: "Latest result",
      description: nodeSummary,
      content: latestResultNode ? nodeResultContent(latestResultNode) : undefined,
      statusLabel: latestResultNode?.statusLabel ?? latestResultNode?.status,
      tone: overviewToneForNode(latestResultNode),
      actionLabel: "Review result actions",
      actionNodeId: latestResultNode?.id,
    };
  }

  if (pageData.latestRunSummary) {
    return {
      id: `run-${pageData.latestRunSummary.id}`,
      title: "Latest run",
      description: `Run is ${pageData.latestRunSummary.status}`,
      statusLabel: pageData.latestRunSummary.syncStatus,
      tone: pageData.latestRunSummary.status === "Completed" ? "success" : "info",
      actionLabel: "Review run context",
    };
  }

  return {
    id: "latest-result-empty",
    title: "Latest result",
    description: "No execution result yet.",
    tone: "neutral",
  };
}

function buildAttentionCard(pageData: TaskPageData, currentNode: PlanNodeDataModel | null): ExecutionOverviewCard | null {
  const pendingApproval = pageData.approvals.find((approval) => approval.status !== "Approved" && approval.status !== "Rejected");
  if (pendingApproval) {
    return {
      id: `approval-${pendingApproval.id}`,
      title: "Needs handling",
      description: pendingApproval.title,
      statusLabel: pendingApproval.status,
      tone: "warning",
      actionLabel: "Resolve in node panel",
      actionNodeId: currentNode?.id,
    };
  }

  if (currentNode && isCheckpointStatus(currentNode.status)) {
    return {
      id: `node-attention-${currentNode.id}`,
      title: "Needs handling",
      description: currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: "Open action controls",
      actionNodeId: currentNode.id,
    };
  }

  if (pageData.task.blockReason) {
    return {
      id: "task-block-reason",
      title: "Blocked",
      description: pageData.task.blockReason.actionRequired ?? pageData.task.runnabilitySummary,
      statusLabel: pageData.task.blockReason.blockType,
      tone: "critical",
    };
  }

  if (currentNode && isAttentionStatus(currentNode.status)) {
    return {
      id: `node-attention-${currentNode.id}`,
      title: "Needs handling",
      description: currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: "Open action controls",
      actionNodeId: currentNode.id,
    };
  }

  return null;
}

function buildReadinessCard(pageData: TaskPageData, currentNode: PlanNodeDataModel | null): ExecutionOverviewCard {
  const pendingProposal = pageData.scheduleProposals.find((proposal) => proposal.status === "Pending");
  if (pendingProposal) {
    return {
      id: `schedule-proposal-${pendingProposal.id}`,
      title: "Ready to schedule",
      description: pendingProposal.summary,
      statusLabel: pendingProposal.status,
      tone: "warning",
    };
  }

  if (!pageData.task.isRunnable) {
    return {
      id: "task-not-runnable",
      title: "Execution readiness",
      description: pageData.task.runnabilitySummary,
      statusLabel: pageData.task.runnabilityState ?? pageData.task.scheduleStatus,
      tone: "warning",
    };
  }

  if (currentNode) {
    return {
      id: `current-node-${currentNode.id}`,
      title: "Current work",
      description: currentNode.nextAction ?? currentNode.summary ?? currentNode.objective,
      statusLabel: currentNode.statusLabel ?? currentNode.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: currentNode.status === "blocked" ? "Open retry controls" : "Open run controls",
      actionNodeId: currentNode.id,
    };
  }

  return {
    id: "execution-ready-empty",
    title: "Execution readiness",
    description: pageData.task.scheduleStatus === "Unscheduled"
      ? "No accepted plan is ready to run yet."
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
    content: stringifyNodeResultOutput(output),
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
  const providerActivity = (pageData.activityTimeline ?? []).slice(-20).reverse();
  const approvalActivity = pageData.approvals.slice(0, 3).map((approval) => ({
    id: `approval-${approval.id}`,
    title: approval.title,
    description: `Approval ${approval.status}`,
    tone: approval.status === "Approved" || approval.status === "EditedAndApproved" ? "success" as const : "warning" as const,
    timestamp: approval.requestedAt,
  }));

  const artifactActivity = pageData.artifacts.slice(0, 3).map((artifact) => ({
    id: `artifact-${artifact.id}`,
    title: artifact.title,
    description: `Artifact ${artifact.type}`,
    tone: "info" as const,
  }));

  const proposalActivity = pageData.scheduleProposals
    .filter((proposal) => proposal.status === "Pending")
    .slice(0, 2)
    .map((proposal) => ({
      id: `schedule-proposal-${proposal.id}`,
      title: "Schedule proposal",
      description: proposal.summary,
      tone: "warning" as const,
      timestamp: proposal.scheduledStartAt,
    }));

  const nodeActivity = (graphPlan?.nodes ?? [])
    .filter((node) => node.status !== "idle" && node.status !== "pending")
    .slice(0, 5)
    .map((node) => ({
      id: `node-${node.id}`,
      title: node.title,
      description: node.statusLabel ?? node.status,
      tone: overviewToneForNode(node),
    }));

  if (pageData.latestRunSummary) {
    return [...providerActivity, {
      id: `run-${pageData.latestRunSummary.id}`,
      title: "Latest run",
      description: pageData.latestRunSummary.status,
      tone: pageData.latestRunSummary.status === "Completed" ? "success" : "info",
      timestamp: pageData.latestRunSummary.startedAt,
    }, ...approvalActivity, ...artifactActivity, ...proposalActivity, ...nodeActivity];
  }

  return [...providerActivity, ...approvalActivity, ...artifactActivity, ...proposalActivity, ...nodeActivity];
}

function buildTaskHeaderView(
  pageData: TaskPageData,
  progress: ProgressSummary,
  hasAttention: boolean,
  currentNode: PlanNodeDataModel | null,
): TaskHeaderView {
  const memberContext = buildWorkspaceMemberContext(pageData, hasAttention);
  const allNodesDone = progress.totalSteps > 0 && progress.completedSteps === progress.totalSteps;
  const currentNodeStatus = !allNodesDone && currentNode && isAttentionStatus(currentNode.status)
    ? mapTaskWorkspaceStatus(currentNode.status)
    : null;
  const workspaceStatus = currentNodeStatus ?? (pageData.task.executionSummary
    ? mapTaskWorkspaceStatus(pageData.task.executionSummary.executionState)
    : mapTaskWorkspaceStatus(pageData.task.status));
  const hasPlan = progress.totalSteps > 0 || Boolean(pageData.task.savedPlan);
  const cannotStartReason = !hasPlan
    ? "Generate and accept a plan before starting execution."
    : !pageData.task.isRunnable
      ? pageData.task.runnabilitySummary
      : workspaceStatus === "running"
        ? "Task is already running."
        : workspaceStatus === "approval-needed"
          ? "Task is waiting for checkpoint input."
          : workspaceStatus === "blocked"
            ? "Resolve the blocker before starting execution."
            : workspaceStatus === "completed"
              ? "Task is completed."
              : undefined;
  const cannotStopReason = workspaceStatus === "running" || workspaceStatus === "approval-needed"
    ? undefined
    : "No running execution session to stop.";

  return {
    breadcrumb: ["Tasks", pageData.task.title],
    title: pageData.task.title,
    canEditTitle: true,
    status: workspaceStatus,
    completedSteps: progress.completedSteps,
    totalSteps: progress.totalSteps,
    progressPercent: progress.percentComplete,
    actions: [
      { id: "start", label: "Start", disabled: Boolean(cannotStartReason), disabledReason: cannotStartReason },
      { id: "pause", label: "Pause", disabled: true, disabledReason: "Pause is visible for task control, but the execution API does not expose pause yet." },
      { id: "stop", label: "Stop", disabled: Boolean(cannotStopReason), disabledReason: cannotStopReason },
      { id: "more", label: "More actions" },
    ],
    memberContext,
    primaryStateLabel: pageData.task.executionSummary?.stateLabel,
    primaryActionLabel: pageData.task.executionSummary?.primaryAction.label ?? null,
    currentNodeId: pageData.task.executionSummary?.currentNodeId ?? null,
  };
}

function buildWorkspaceNavigationView(pageData: TaskPageData, hasAttention: boolean): WorkspaceNavigationView {
  const memberContext = buildWorkspaceMemberContext(pageData, hasAttention);

  return {
    brandName: "Chrona",
    primarySections: [
      { id: "overview", label: "Overview", active: false },
      { id: "tasks", label: "Tasks", active: true },
      { id: "plans", label: "Plan library", active: false },
      { id: "knowledge", label: "Knowledge base", active: false },
      { id: "tools", label: "Tools", active: false },
      { id: "integrations", label: "Integrations", active: false },
    ],
    activeSection: "tasks",
    notificationCount: memberContext.notificationCount,
    settingsAvailable: true,
    memberIdentity: memberContext.memberLabel,
  };
}

function buildExecutionFlowView(
  graphPlan: TaskPlanGraphPlan | null,
  selectedNode: PlanNodeDataModel | null,
): ExecutionFlowView {
  const nodes = graphPlan?.nodes ?? [];

  return {
    nodes: nodes.map((node, index) => ({
      id: node.id,
      stepNumber: index + 1,
      title: node.title,
      status: mapTaskWorkspaceStatus(node.status),
      timestampLabel: node.statusLabel ?? node.status,
      hasArtifacts: Boolean(node.resultOutputs?.length || node.resultEvidence),
      artifactCount: node.resultOutputs?.length ?? 0,
      requiresHumanAction: node.requiresHumanInput === true || isAttentionStatus(node.status),
      dependencyIds: node.dependencies ?? [],
    })),
    connections: (graphPlan?.edges ?? []).flatMap((edge) => {
      const from = edge.from ?? edge.fromNodeId;
      const to = edge.to ?? edge.toNodeId;
      return from && to ? [{ id: edge.id, from, to }] : [];
    }),
    selectedNodeId: selectedNode?.id ?? graphPlan?.currentStepId ?? null,
    legend: [
      { status: "completed", label: "Completed" },
      { status: "running", label: "Running" },
      { status: "waiting", label: "Waiting" },
      { status: "approval-needed", label: "Approval needed" },
      { status: "blocked", label: "Blocked" },
    ],
    controls: {
      canZoom: nodes.length > 0,
      canFit: nodes.length > 0,
      canCenter: nodes.length > 0,
      canExpand: nodes.length > 0,
    },
  };
}

export function createTaskWorkspaceExecutionConsoleView(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  selectedNode?: PlanNodeDataModel | null;
}): TaskWorkspaceExecutionConsoleView {
  const task = {
    ...input.pageData.task,
    status: deriveTaskStatusFromGraph(input.pageData.task.status, input.graphPlan),
  } satisfies TaskData;
  const pageData = { ...input.pageData, task } satisfies TaskPageData;
  const currentNode = pickWorkspaceCurrentNode(input.graphPlan, input.selectedNode ?? null);
  const progress = buildProgressSummary(input.graphPlan);
  const attention = buildAttentionCard(pageData, currentNode);
  const isPermissionLimited = !pageData.task.isRunnable && !pageData.task.blockReason;
  const isStale = pageData.latestRunSummary?.syncStatus === "stale";
  const errorMessage = input.graphPlan?.state === "empty" && pageData.task.status === "Failed" ? pageData.task.runnabilitySummary : null;

  return {
    task,
    header: buildTaskHeaderView(pageData, progress, Boolean(attention), currentNode),
    navigation: buildWorkspaceNavigationView(pageData, Boolean(attention)),
    executionFlow: buildExecutionFlowView(input.graphPlan, input.selectedNode ?? currentNode),
    graphPlan: input.graphPlan,
    progress,
    nodeDetail: {
      selectedNode: input.selectedNode ?? null,
      currentNode,
      title: currentNode?.title ?? "No plan node selected",
      description: currentNode?.summary ?? currentNode?.objective ?? "Generate or select a plan node to inspect execution details.",
      status: currentNode ? mapTaskWorkspaceStatus(currentNode.status) : null,
      stepPosition: currentNode ? `${(input.graphPlan?.nodes ?? []).findIndex((node) => node.id === currentNode.id) + 1}/${input.graphPlan?.nodes.length ?? 0}` : "0/0",
      autoRefreshEnabled: currentNode ? ["running", "approval-needed"].includes(mapTaskWorkspaceStatus(currentNode.status)) : false,
      tabs: ["result", "evidence", "action", "configuration"],
      disabledActionReason:
        currentNode &&
        (currentNode.availableActions?.length ?? 0) === 0 &&
        (currentNode.interactiveFields?.length ?? 0) === 0
          ? "No actions are available for this node."
          : undefined,
      isEmpty: !currentNode,
    },
    readiness: buildReadinessCard(pageData, currentNode),
    latestResult: buildLatestResultCard(pageData, input.graphPlan),
    attention,
    artifacts: buildArtifactItems(pageData, input.graphPlan),
    activity: buildActivity(pageData, input.graphPlan),
    states: {
      isEmpty: (input.graphPlan?.nodes.length ?? 0) === 0,
      isStale,
      isPermissionLimited,
      errorMessage,
      treatment: buildWorkspaceStateTreatment({
        currentNode,
        hasPlan: (input.graphPlan?.nodes.length ?? 0) > 0,
        allNodesDone: Boolean(input.graphPlan?.nodes.length) && Boolean(input.graphPlan?.nodes.every((node) => isDoneStatus(node.status))),
        isBlocked: Boolean(pageData.task.blockReason),
        isStale,
        isPermissionLimited,
        permissionSummary: pageData.task.runnabilitySummary,
        blockActionRequired: pageData.task.blockReason?.actionRequired,
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
  const response = await fetch(`/api/tasks/${taskId}/execution/current`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load current execution state" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load current execution state");
  }

  return await response.json() as PlanExecutionResult;
}

export async function dispatchTaskExecutionAction(
  taskId: string,
  action: ExecutionActionInput,
): Promise<TaskWorkspaceCommandAck> {
  const response = await fetch(`/api/work/${taskId}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ type: "execution.action", ...action }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to dispatch execution action" }));
    throw new Error((err as { error?: string }).error ?? "Failed to dispatch execution action");
  }

  const ack = await response.json() as Omit<TaskWorkspaceCommandAck, "message">;
  return { ...ack, message: "Command accepted. Workspace will update shortly." };
}

export async function submitTaskCheckpointAction(
  taskId: string,
  action: SubmitCheckpointActionInput,
): Promise<TaskWorkspaceCommandAck> {
  const response = await fetch(`/api/work/${taskId}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      type: "checkpoint.action",
      checkpointId: action.checkpointId,
      action: action.action,
      payload: action.payload,
      idempotencyKey: action.idempotencyKey,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to submit checkpoint action" }));
    throw new Error((err as { error?: string }).error ?? "Failed to submit checkpoint action");
  }

  const ack = await response.json() as Omit<TaskWorkspaceCommandAck, "message">;
  return { ...ack, message: "Command accepted. Workspace will update shortly." };
}

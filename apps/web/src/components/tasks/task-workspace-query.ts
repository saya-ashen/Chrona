import { api } from "@/lib/rpc-client";
import { fetchJsonEventSource } from "@/lib/fetch-json-event-source";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/task/plan/task-plan-graph/types";
import type { ExecutionActionInput, PlanExecutionResult, PlanExecutionSSEEvent, TaskPlanGenerationSessionReadModel } from "@chrona/contracts/ai";
import type {
  ExecutionOverviewCard,
  ExecutionOverviewTone,
  ProgressSummary,
  TaskData,
  TaskPageData,
  TaskPlanGenerationStatus,
  TaskWorkspaceExecutionConsoleView,
  WorkspaceActivityItem,
  WorkspaceArtifactItem,
} from "./task-workspace-types";

export type TaskExecutionDispatchResult = PlanExecutionResult;

export type TaskPlanState = {
  taskId: string;
  aiPlanGenerationStatus: TaskPlanGenerationStatus;
  savedPlan: TaskData["savedPlan"] | null;
  generationSession: TaskPlanGenerationSessionReadModel | null;
};

export const taskWorkspaceQueryKeys = {
  all: ["task-workspace"] as const,
  detail: (taskId: string) => [...taskWorkspaceQueryKeys.all, "detail", taskId] as const,
  planState: (taskId: string) => [...taskWorkspaceQueryKeys.all, "plan-state", taskId] as const,
};

function isDoneStatus(status: PlanNodeDataModel["status"]) {
  return status === "done" || status === "completed" || status === "skipped";
}

function isAttentionStatus(status: PlanNodeDataModel["status"]) {
  return status === "waiting" || status === "waiting_for_user" || status === "blocked";
}

function overviewToneForNode(node: PlanNodeDataModel | null): ExecutionOverviewTone {
  if (!node) return "neutral";
  if (node.status === "blocked") return "critical";
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

function buildLatestResultCard(pageData: TaskPageData, currentNode: PlanNodeDataModel | null): ExecutionOverviewCard {
  const nodeSummary = currentNode?.completionSummary
    ?? currentNode?.result?.outputSummary
    ?? null;

  if (nodeSummary) {
    return {
      id: `node-result-${currentNode?.id ?? "current"}`,
      title: "Latest result",
      description: nodeSummary,
      statusLabel: currentNode?.statusLabel ?? currentNode?.status,
      tone: overviewToneForNode(currentNode),
      actionLabel: "Review result actions",
      actionNodeId: currentNode?.id,
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
      actionNodeId: currentNode?.id,
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
    return [{
      id: `run-${pageData.latestRunSummary.id}`,
      title: "Latest run",
      description: pageData.latestRunSummary.status,
      tone: pageData.latestRunSummary.status === "Completed" ? "success" : "info",
      timestamp: pageData.latestRunSummary.startedAt,
    }, ...approvalActivity, ...artifactActivity, ...proposalActivity, ...nodeActivity];
  }

  return [...approvalActivity, ...artifactActivity, ...proposalActivity, ...nodeActivity];
}

export function createTaskWorkspaceExecutionConsoleView(input: {
  pageData: TaskPageData;
  graphPlan: TaskPlanGraphPlan | null;
  selectedNode?: PlanNodeDataModel | null;
}): TaskWorkspaceExecutionConsoleView {
  const currentNode = pickWorkspaceCurrentNode(input.graphPlan, input.selectedNode ?? null);

  return {
    task: input.pageData.task,
    graphPlan: input.graphPlan,
    progress: buildProgressSummary(input.graphPlan),
    nodeDetail: {
      selectedNode: input.selectedNode ?? null,
      currentNode,
      title: currentNode?.title ?? "No plan node selected",
      description: currentNode?.summary ?? currentNode?.objective ?? "Generate or select a plan node to inspect execution details.",
      isEmpty: !currentNode,
    },
    readiness: buildReadinessCard(input.pageData, currentNode),
    latestResult: buildLatestResultCard(input.pageData, currentNode),
    attention: buildAttentionCard(input.pageData, currentNode),
    artifacts: buildArtifactItems(input.pageData, input.graphPlan),
    activity: buildActivity(input.pageData, input.graphPlan),
  };
}

export async function fetchTaskWorkspaceTask(taskId: string) {
  const response = await api.tasks[":taskId"].$get({
    param: { taskId },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load task detail" }));
    throw new Error((err as { error?: string }).error ?? "Failed to load task detail");
  }

  const payload = await response.json() as unknown as { task: TaskData };
  return payload.task;
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

export async function dispatchTaskExecutionAction(
  taskId: string,
  action: ExecutionActionInput,
  onEvent: (event: PlanExecutionSSEEvent) => void,
): Promise<TaskExecutionDispatchResult> {
  let result: TaskExecutionDispatchResult | null = null;

  await fetchJsonEventSource(`/api/tasks/${taskId}/execution/actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(action),
    onEvent({ data }) {
      const event = data as PlanExecutionSSEEvent;
      onEvent(event);
      if (event.type === "result") {
        result = event.result;
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    },
  });

  if (!result) {
    throw new Error("Execution stream ended without a result");
  }

  return result;
}

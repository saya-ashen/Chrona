import { deriveWorkStateView } from "@chrona/domain";
import type { AiSidebarPageContextSummary, AiSidebarQuickAction } from "@chrona/contracts";
import type { GraphNodeState } from "@chrona/contracts";
import type { TaskData, TaskPageData } from "../model/task-workspace-types";
import { settleAcceptedResultWorkState } from "../model/task-workspace-settlement";

type TaskHighlight = AiSidebarPageContextSummary["highlights"][number];

function findActiveNode(task: TaskData): GraphNodeState | undefined {
  const currentNodeId = task.executionSummary?.currentNodeId;
  return task.graphNodeStates?.find((node) => node.id === currentNodeId)
    ?? task.graphNodeStates?.find((node) => node.current || node.status === "running")
    ?? task.graphNodeStates?.find((node) => node.requiresAction)
    ?? task.graphNodeStates?.[0];
}

function getPlanNodeTitle(task: TaskData, nodeId: string | null) {
  if (!nodeId) return null;
  const node = task.savedPlan?.effectivePlan.nodes.find((item: { id: string; nodeId?: string | null }) => item.id === nodeId || item.nodeId === nodeId);
  return node?.title ?? null;
}

function createAttentionHighlights(reviewState: string | null, blockReason: string | null): TaskHighlight[] {
  const highlights: TaskHighlight[] = [];

  if (reviewState) highlights.push({ label: "Needs review", value: reviewState, tone: "warning" });
  if (blockReason) highlights.push({ label: "Blocked", value: blockReason, tone: "critical" });

  return highlights;
}

function createActiveNodeHighlight({ nodeLabel, activeNodeStatus, executionState }: {
  nodeLabel: string | null;
  activeNodeStatus: string | null;
  executionState?: TaskData["executionSummary"] extends infer Summary
    ? Summary extends { executionState?: infer State } ? State : string
    : string;
}): TaskHighlight | null {
  if (!nodeLabel) return null;
  if (activeNodeStatus === "running" || executionState === "running") {
    return { label: "Running", value: nodeLabel, tone: "info" as const };
  }
  if (activeNodeStatus === "waiting_for_user" || activeNodeStatus === "waiting_for_approval") {
    return { label: "Waiting", value: nodeLabel, tone: "warning" as const };
  }

  return null;
}

function createTaskHighlights({ task, nodeLabel, activeNodeStatus, blockReason, reviewState, primaryAction, latestActivitySummary }: {
  task: TaskData;
  nodeLabel: string | null;
  activeNodeStatus: string | null;
  blockReason: string | null;
  reviewState: string | null;
  primaryAction: string;
  latestActivitySummary?: string | null;
}) {
  const activeNodeHighlight = createActiveNodeHighlight({
    nodeLabel,
    activeNodeStatus,
    executionState: task.executionSummary?.executionState,
  });
  const activityHighlight = latestActivitySummary
    ? { label: "Activity", value: latestActivitySummary, tone: "neutral" as const }
    : null;

  return [
    ...createAttentionHighlights(reviewState, blockReason),
    activeNodeHighlight,
    { label: "Next", value: primaryAction, tone: task.isRunnable ? "info" as const : "warning" as const },
    { label: "Task", value: task.title },
    { label: "State", value: task.status },
    { label: "Active node", value: nodeLabel ?? "No active node" },
    activityHighlight,
  ].filter((item): item is TaskHighlight => Boolean(item));
}

function createTaskActions({ hasPlan, hasActiveNode, blockReason }: {
  hasPlan: boolean;
  hasActiveNode: boolean;
  blockReason: string | null;
}): AiSidebarQuickAction[] {
  return [
    {
      id: "explain-blocker",
      label: "Explain blocker",
      description: blockReason ? "Explain what blocks this task and the safest next step." : "Summarize why this task is currently unblocked.",
      kind: "informational",
      enabled: true,
    },
    {
      id: "modify-plan",
      label: "Modify plan",
      description: "Preview a task plan adjustment before applying it.",
      kind: "mutating-preview",
      enabled: hasPlan,
      disabledReason: "Generate and accept a plan before modifying it.",
    },
    {
      id: "retry-node",
      label: "Retry node",
      description: "Preview retrying the current node.",
      kind: "mutating-preview",
      enabled: hasActiveNode,
      disabledReason: "No active node is available.",
    },
    {
      id: "add-step",
      label: "Add step",
      description: "Preview adding a guarded follow-up step.",
      kind: "mutating-preview",
      enabled: true,
    },
  ];
}

function createTaskFingerprint({ task, activeNodeId, activeNodeStatus, blockReason, reviewState }: {
  task: TaskData;
  activeNodeId: string | null;
  activeNodeStatus: string | null;
  blockReason: string | null;
  reviewState: string | null;
}) {
  return [
    task.id,
    task.status,
    activeNodeId ?? "none",
    activeNodeStatus ?? "none",
    blockReason ?? "none",
    reviewState ?? "none",
  ].join(":");
}

function createTaskContext({ task, activeNodeId, activeNodeStatus, blockReason, reviewState, primaryAction, latestActivitySummary, workStateLabel }: {
  task: TaskData;
  activeNodeId: string | null;
  activeNodeStatus: string | null;
  blockReason: string | null;
  reviewState: string | null;
  primaryAction: string;
  latestActivitySummary?: string | null;
  workStateLabel: string;
}): AiSidebarPageContextSummary {
  const activeNodeTitle = getPlanNodeTitle(task, activeNodeId);
  const nodeLabel = activeNodeTitle ?? activeNodeId;

  return {
    type: "task",
    fingerprint: createTaskFingerprint({ task, activeNodeId, activeNodeStatus, blockReason, reviewState }),
    title: "Task context",
    primaryObjectLabel: task.title,
    taskId: task.id,
    taskTitle: task.title,
    activeNodeId,
    activeNodeTitle: nodeLabel,
    nodeState: activeNodeStatus ?? workStateLabel,
    blockReason,
    reviewState,
    primaryAction,
    capabilities: ["explain-blocker", "modify-plan", "retry-node", "add-step"],
    highlights: createTaskHighlights({ task, nodeLabel, activeNodeStatus, blockReason, reviewState, primaryAction, latestActivitySummary }),
  };
}

function getTaskBlockReason(task: TaskData) {
  return task.blockReason?.actionRequired ?? task.blockReason?.blockType ?? null;
}

function getTaskReviewState(task: TaskData) {
  return task.executionSummary?.waiting?.reason ?? null;
}

function getTaskPrimaryAction(task: TaskData, pageData?: TaskPageData) {
  return deriveTaskWorkStateView(task, pageData).nextActionLabel;
}

function deriveTaskWorkStateView(task: TaskData, pageData?: TaskPageData) {
  const savedPlanStatus = task.savedPlan?.status ?? null;
  const derived = deriveWorkStateView({
    taskStatus: task.status,
    executionStatus: task.executionSummary?.executionState ?? null,
    planStatus: savedPlanStatus,
    planGenerationStatus: task.aiPlanGenerationStatus ?? null,
    hasPlan: Boolean(task.savedPlan),
    hasAcceptedPlan: savedPlanStatus === "accepted",
    isRunnable: task.isRunnable,
    disabledReason: task.runnabilityState === "blocked" ? task.runnabilitySummary : null,
    currentNodeId: task.executionSummary?.currentNodeId ?? task.blockReason?.nodeId ?? null,
    currentNodeLabel: getPlanNodeTitle(task, task.executionSummary?.currentNodeId ?? null),
    blockReason: task.blockReason,
  });
  return pageData
    ? settleAcceptedResultWorkState(pageData, derived)
    : derived;
}

export function createTaskAiSidebarContext(task: TaskData, options: {
  latestActivitySummary?: string | null;
  pageData?: TaskPageData;
} = {}): {
  context: AiSidebarPageContextSummary;
  actions: AiSidebarQuickAction[];
} {
  const activeNode = findActiveNode(task);
  const activeNodeId = activeNode?.id ?? null;
  const activeNodeStatus = activeNode?.status ?? null;
  const blockReason = getTaskBlockReason(task);
  const reviewState = getTaskReviewState(task);
  const primaryAction = getTaskPrimaryAction(task, options.pageData);
  const workState = deriveTaskWorkStateView(task, options.pageData);
  return {
    context: createTaskContext({ task, activeNodeId, activeNodeStatus, blockReason, reviewState, primaryAction, latestActivitySummary: options.latestActivitySummary, workStateLabel: workState.label }),
    actions: createTaskActions({ hasPlan: Boolean(task.savedPlan), hasActiveNode: Boolean(activeNode), blockReason }),
  };
}

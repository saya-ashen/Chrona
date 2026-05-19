import type { AiSidebarPageContextSummary, AiSidebarQuickAction } from "@chrona/contracts";
import type { TaskData } from "../model/task-workspace-types";

function findActiveNode(task: TaskData) {
  return task.graphNodeStates?.find((node) => node.current || node.status === "running") ?? task.graphNodeStates?.[0];
}

function createTaskHighlights({ task, activeNodeId, blockReason, primaryAction }: {
  task: TaskData;
  activeNodeId: string | null;
  blockReason: string | null;
  primaryAction: string;
}) {
  return [
    { label: "Task", value: task.title },
    { label: "State", value: task.status },
    { label: "Active node", value: activeNodeId ?? "No active node" },
    { label: "Blocker", value: blockReason ?? "None", tone: blockReason ? "warning" as const : "success" as const },
    { label: "Primary action", value: primaryAction, tone: task.isRunnable ? "info" as const : "warning" as const },
  ];
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

function createTaskContext({ task, activeNodeId, activeNodeStatus, blockReason, reviewState, primaryAction }: {
  task: TaskData;
  activeNodeId: string | null;
  activeNodeStatus: string | null;
  blockReason: string | null;
  reviewState: string | null;
  primaryAction: string;
}): AiSidebarPageContextSummary {
  return {
    type: "task",
    fingerprint: createTaskFingerprint({ task, activeNodeId, activeNodeStatus, blockReason, reviewState }),
    title: "Task context",
    primaryObjectLabel: task.title,
    taskId: task.id,
    taskTitle: task.title,
    activeNodeId,
    activeNodeTitle: activeNodeId,
    nodeState: activeNodeStatus ?? task.status,
    blockReason,
    reviewState,
    primaryAction,
    capabilities: ["explain-blocker", "modify-plan", "retry-node", "add-step"],
    highlights: createTaskHighlights({ task, activeNodeId, blockReason, primaryAction }),
  };
}

export function createTaskAiSidebarContext(task: TaskData): {
  context: AiSidebarPageContextSummary;
  actions: AiSidebarQuickAction[];
} {
  const activeNode = findActiveNode(task);
  const blockReason = task.blockReason?.actionRequired ?? task.blockReason?.blockType ?? null;
  const reviewState = task.executionSummary?.waiting ? "Review required" : null;
  const primaryAction = task.isRunnable ? "Continue task" : "Resolve runnability";
  const activeNodeId = activeNode?.id ?? null;
  const activeNodeStatus = activeNode?.status ?? null;

  return {
    context: createTaskContext({ task, activeNodeId, activeNodeStatus, blockReason, reviewState, primaryAction }),
    actions: createTaskActions({ hasPlan: Boolean(task.savedPlan), hasActiveNode: Boolean(activeNode), blockReason }),
  };
}

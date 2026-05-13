import type { TaskConfigExecutionRuntime } from "@/components/schedule/forms/task-config-form";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskPlanReadModel, TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";

export type TaskPlanGenerationStatus = "idle" | "generating" | "waiting_acceptance" | "accepted";

export type TaskData = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  executionRuntime: string;
  executionConfig: unknown;
  status: string;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  scheduleSource: string | null;
  isRunnable: boolean;
  runnabilitySummary: string;
  runnabilityState?: string;
  savedPlan?: TaskPlanReadModel | null;
  aiPlanGenerationStatus?: TaskPlanGenerationStatus;
  blockReason: {
    blockType?: string;
    actionRequired?: string;
    scope?: string;
    since?: string;
  } | null;
  dependencies: Array<{
    id: string;
    dependencyType: string;
    dependsOnTask: {
      id: string;
      title: string;
      status: string;
    };
  }>;
};

export type TaskPageData = {
  defaultExecutionRuntime: string;
  executionRuntimes: TaskConfigExecutionRuntime[];
  task: TaskData;
  latestRunSummary: {
    id: string;
    status: string;
    startedAt: string | null;
    syncStatus: string;
  } | null;
  scheduleProposals: Array<{
    id: string;
    source: string;
    proposedBy: string;
    summary: string;
    status: string;
    dueAt: string | null;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
  }>;
  approvals: Array<{
    id: string;
    title: string;
    status: string;
    riskLevel?: string;
    requestedAt?: string;
  }>;
  artifacts: Array<{
    id: string;
    title: string;
    type: string;
    uri?: string;
  }>;
};

export type EditableTask = {
  title: string;
  description: string | null;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  executionRuntime: string;
  executionConfig: unknown;
};

export type CurrentProposalState = {
  proposal: TaskWorkspaceUpdateProposal;
  originalTask: EditableTask;
};

export type ProgressSummary = {
  completedSteps: number;
  totalSteps: number;
  percentComplete: number;
  label: string;
};

export type TaskWorkspaceUserStatus = "completed" | "running" | "waiting" | "approval-needed" | "blocked";

export type TaskHeaderAction = {
  id: "continue" | "pause" | "export" | "more";
  label: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type TaskHeaderView = {
  breadcrumb: string[];
  title: string;
  canEditTitle: boolean;
  status: TaskWorkspaceUserStatus;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  actions: TaskHeaderAction[];
  memberContext: {
    memberLabel: string;
    notificationCount: number;
  };
};

export type WorkspaceNavigationView = {
  brandName: string;
  primarySections: Array<{
    id: string;
    label: string;
    active: boolean;
  }>;
  activeSection: string;
  notificationCount: number;
  settingsAvailable: boolean;
  memberIdentity: string;
};

export type ExecutionFlowView = {
  nodes: Array<{
    id: string;
    stepNumber: number;
    title: string;
    status: TaskWorkspaceUserStatus;
    timestampLabel: string;
    hasArtifacts: boolean;
    artifactCount: number;
    requiresHumanAction: boolean;
    dependencyIds: string[];
  }>;
  connections: Array<{
    id: string;
    from: string;
    to: string;
  }>;
  selectedNodeId: string | null;
  legend: Array<{
    status: TaskWorkspaceUserStatus;
    label: string;
  }>;
  controls: {
    canZoom: boolean;
    canFit: boolean;
    canCenter: boolean;
    canExpand: boolean;
  };
};

export type ExecutionOverviewTone = "neutral" | "info" | "success" | "warning" | "critical";

export type ExecutionOverviewCard = {
  id: string;
  title: string;
  description: string;
  statusLabel?: string;
  tone: ExecutionOverviewTone;
  actionLabel?: string;
  actionNodeId?: string;
};

export type WorkspaceArtifactItem = {
  id: string;
  title: string;
  type: string;
  uri?: string;
  sourceNodeId?: string;
};

export type WorkspaceActivityItem = {
  id: string;
  title: string;
  description: string;
  tone: ExecutionOverviewTone;
  timestamp?: string | null;
};

export type NodeDetailPanelState = {
  selectedNode: PlanNodeDataModel | null;
  currentNode: PlanNodeDataModel | null;
  title: string;
  description: string;
  status: TaskWorkspaceUserStatus | null;
  stepPosition: string;
  autoRefreshEnabled: boolean;
  tabs: Array<"result" | "evidence" | "action" | "configuration">;
  disabledActionReason?: string;
  isEmpty: boolean;
};

export type TaskWorkspaceExecutionConsoleView = {
  task: TaskData;
  header: TaskHeaderView;
  navigation: WorkspaceNavigationView;
  executionFlow: ExecutionFlowView;
  graphPlan: TaskPlanGraphPlan | null;
  progress: ProgressSummary;
  nodeDetail: NodeDetailPanelState;
  readiness: ExecutionOverviewCard;
  latestResult: ExecutionOverviewCard;
  attention: ExecutionOverviewCard | null;
  artifacts: WorkspaceArtifactItem[];
  activity: WorkspaceActivityItem[];
  states: {
    isEmpty: boolean;
    isStale: boolean;
    isPermissionLimited: boolean;
    errorMessage: string | null;
  };
};

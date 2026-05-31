import type { TaskConfigExecutionRuntime } from "@/components/schedule/forms/task-config-form";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "@/components/tasks/plan/task-plan-graph/types";
import type { TaskPlanReadModel, TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import type { GraphNodeState, ReconciliationResult, TaskExecutionSummary } from "@chrona/contracts";

export type TaskPlanGenerationStatus = "idle" | "generating" | "waiting_acceptance" | "accepted";

export type TaskData = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  executionRuntime: string;
  executionConfig: unknown;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
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
  executionSummary?: TaskExecutionSummary | null;
  graphNodeStates?: GraphNodeState[];
  aiPlanGenerationStatus?: TaskPlanGenerationStatus;
  blockReason: {
    blockType?: string;
    actionRequired?: string;
    scope?: string;
    nodeId?: string;
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
  reconciliation?: ReconciliationResult | null;
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
  activityTimeline?: WorkspaceActivityItem[];
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
  autoPlanGeneration: boolean;
  autoExecute: boolean;
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

export type WorkspaceStateTreatment = {
  label: string;
  tone: ExecutionOverviewTone;
  guidance: string;
};

export type TaskHeaderAction = {
  id: "start" | "pause" | "stop" | "more";
  label: string;
  disabled?: boolean;
  disabledReason?: string;
};

export type TaskWorkspaceState = {
  taskId: string;
  selectedNodeId: string | null;
  activeActionId: string | null;
  stale: boolean;
  permissionLimited: boolean;
};

export type TaskHeaderView = {
  title: string;
  canEditTitle: boolean;
  status: TaskWorkspaceUserStatus;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  actions: TaskHeaderAction[];
  primaryStateLabel?: string;
  primaryActionLabel?: string | null;
  currentNodeId?: string | null;
};

export type ExecutionOverviewTone = "neutral" | "info" | "success" | "warning" | "critical";

export type ExecutionOverviewCard = {
  id: string;
  title: string;
  description: string;
  content?: string;
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
  content?: string;
};

export type WorkspaceActivityKind =
  | "assistant_message"
  | "reasoning"
  | "tool_started"
  | "tool_completed"
  | "provider_run"
  | "approval"
  | "node"
  | "task"
  | "artifact"
  | "schedule"
  | "raw";

export type WorkspaceActivityTone = "neutral" | "info" | "success" | "warning" | "danger";

export type WorkspaceToolActivity = {
  name?: string;
  label?: string;
  preview?: string;
  inputSummary?: string;
  durationMs?: number;
  error?: string;
  state: "started" | "completed" | "failed";
};

export type WorkspaceAssistantActivity = {
  text: string;
  isReasoning: boolean;
  isPartial?: boolean;
};

export type WorkspaceActivityItem = {
  id: string;
  kind: WorkspaceActivityKind;
  title: string;
  summary: string;
  description: string;
  tone: WorkspaceActivityTone;
  timestamp?: string | null;
  sourceNodeId?: string;
  sourceNodeTitle?: string;
  provider?: string;
  runtimeName?: string;
  runId?: string;
  nativeRunId?: string;
  sequence?: number;
  rawEventType?: string;
  tool?: WorkspaceToolActivity;
  assistant?: WorkspaceAssistantActivity;
  raw?: unknown;
};

export type WorkspaceActivityPage = {
  items: WorkspaceActivityItem[];
  nextCursor?: string;
  scope: {
    type: "task" | "node";
    taskId: string;
    nodeId?: string;
    limit: number;
  };
};

export type NodeDetailPanelState = {
  selectedNode: PlanNodeDataModel | null;
  currentNode: PlanNodeDataModel | null;
  title: string;
  description: string;
  status: TaskWorkspaceUserStatus | null;
  stepPosition: string;
  autoRefreshEnabled: boolean;
  tabs: Array<"result" | "activity" | "action" | "configuration">;
  disabledActionReason?: string;
  isEmpty: boolean;
};

export type TaskWorkspaceExecutionConsoleView = {
  task: TaskData;
  header: TaskHeaderView;
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
    treatment: WorkspaceStateTreatment;
  };
};

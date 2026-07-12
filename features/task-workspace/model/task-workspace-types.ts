import type { TaskConfigAiClient, TaskConfigExecutionRuntime } from "@features/schedule";
import type { PlanNodeDataModel, TaskPlanGraphPlan } from "./plan-node-view-model";
import type { TaskPlanReadModel, TaskWorkspaceUpdateProposal } from "@chrona/contracts/ai";
import type { GraphNodeState, ReconciliationResult, TaskExecutionSummary } from "@chrona/contracts";
import type { UiDocument } from "@chrona/ui-protocol";

export type TaskPlanGenerationStatus = "idle" | "generating" | "waiting_acceptance" | "accepted";

export type TaskData = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  executionRuntime: string;
  executionConfig: unknown;
  aiClientId?: string | null;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: string;
  autoExecuteTiming: string;
  recurrenceRule?: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string;
  scheduleSource: string | null;
  currentWorkBlock?: {
    id: string;
    status: string;
    scheduledStartAt: string;
    scheduledEndAt: string;
  } | null;
  recurrenceOccurrences?: Array<{
    taskId: string;
    title: string;
    status: string;
    scheduledStartAt: string | null;
    scheduledEndAt: string | null;
    workBlockId: string | null;
    isCurrent: boolean;
  }>;
  sourceManaged?: {
    source: "external_calendar";
    eventId: string;
    sourceName: string;
    sourceColor: string;
    description: string | null;
    immutableFields: readonly ["title", "scheduledStartAt", "scheduledEndAt"];
  } | null;
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
    detail?: string;
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
  availableAiClients?: TaskConfigAiClient[];
  task: TaskData;
  reconciliation?: ReconciliationResult | null;
  latestRunSummary: {
    id: string;
    status: string;
    displayStatus?: string;
    executionState?: TaskExecutionSummary["executionState"];
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
  commandCenter?: {
    documents: {
      now: UiDocument;
      output: UiDocument;
      trail: UiDocument;
    };
  };
  // Header spec lives on its own endpoint
  // (`GET /api/tasks/:taskId/workspace/header`) and SSR loader puts the
  // first-paint value here. Runtime updates come from the dedicated
  // `useTaskHeaderSpec` query plus `spec.patch` SSE events.
  header?: { spec: UiDocument };
};

export type TaskWorkspaceBootstrapData = Omit<TaskPageData,
  "defaultExecutionRuntime" | "executionRuntimes" | "latestRunSummary" | "scheduleProposals" | "approvals" | "artifacts" | "activityTimeline" | "commandCenter" | "header"
>;

export type TaskWorkspaceRuntimeContextData = Pick<TaskPageData, "defaultExecutionRuntime" | "executionRuntimes" | "availableAiClients">;

export type TaskWorkspaceReviewContextData = Pick<TaskPageData, "latestRunSummary" | "scheduleProposals" | "approvals">;

export type TaskWorkspaceCommandCenterData = NonNullable<TaskPageData["commandCenter"]>;

export type TaskWorkspaceHeaderData = NonNullable<TaskPageData["header"]>;

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
  aiClientId: string | null;
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  recurrenceRule: string | null;
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

export type TaskWorkspaceUserStatus = "completed" | "running" | "waiting" | "input-needed" | "approval-needed" | "blocked";

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
  sourceNodeTitle?: string;
  summary?: string;
  ctaLabel?: string;
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

export type WorkspaceActivityGroup = {
  kind: "plan_generation" | "execution_node" | "provider_run";
  id: string;
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
  activityGroup?: WorkspaceActivityGroup;
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
  tabs: Array<"result" | "activity" | "configuration">;
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
  latestCompletedNode: PlanNodeDataModel | null;
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

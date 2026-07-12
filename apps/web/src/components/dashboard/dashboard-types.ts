import type { WorkStateView } from "@chrona/domain";
export type DashboardAiBriefStatus = "ready" | "dirty" | "generating" | "failed" | "unconfigured" | "disabled";

export type DashboardAiBriefState = {
  status: DashboardAiBriefStatus;
  spec: unknown | null;
  generatedAt: string | null;
  providerClientId: string | null;
  canGenerate: boolean;
  errorMessage: string | null;
  inputFingerprint: string;
};

export type DashboardAttentionKind =
  "approval" | "input" | "blocked" | "failed" | "schedule_risk";

export type DashboardCompletionCategory =
  "report" | "research" | "code" | "automation";

export type DashboardOutput = {
  id: string;
  title: string;
  type: string;
  taskId: string;
};

type OutputRef = DashboardOutput | null;

export interface DashboardTaskItem {
  taskId: string;
  title: string;
  stateView: WorkStateView;
  priority: string;
  scheduleStatus: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  dueAt: string | null;
  reason: string | null;
  stage: string | null;
  latestOutput: OutputRef;
  updatedAt: string | null;
}

export type DashboardFocusTask = DashboardTaskItem;

export interface DashboardAttentionItem {
  taskId: string;
  title: string;
  stateView: WorkStateView;
  priority: string;
  kind: DashboardAttentionKind;
  reason: string | null;
  latestOutput: OutputRef;
  updatedAt: string | null;
}

export interface DashboardInProgressItem {
  taskId: string;
  title: string;
  stateView: WorkStateView;
  latestRunStatus: string | null;
  stage: string | null;
  latestOutput: OutputRef;
  updatedAt: string | null;
}

export interface DashboardCompletedItem {
  taskId: string;
  title: string;
  completedAt: string | null;
  summary: string | null;
  category: DashboardCompletionCategory;
  output: OutputRef;
}

export interface DashboardEvent {
  id: string;
  category: string;
  at: string;
  taskId: string;
  taskTitle: string;
  summary: string | null;
}

export interface DashboardData {
  generatedAt: string;
  workspaceId: string;
  focusTask: DashboardTaskItem | null;
  needsAttention: DashboardAttentionItem[];
  inProgress: DashboardInProgressItem[];
  upcomingToday: DashboardTaskItem[];
  autoCompleted: DashboardCompletedItem[];
  totalAutoCompleted: number;
  recentEvents: DashboardEvent[];
  aiBrief: DashboardAiBriefState;
}

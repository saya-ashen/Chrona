import type { WorkItemStateView } from "@chrona/domain";
import type { DashboardAiBriefState } from "@chrona/engine";

export type DashboardNextStep =
  | "approve_or_edit"
  | "resolve_block"
  | "provide_input"
  | "await_completion"
  | "start_execution"
  | "reschedule"
  | "review_result";

export type DashboardAttentionKind =
  | "approval"
  | "input"
  | "blocked"
  | "failed"
  | "schedule_risk";

export type DashboardCompletionCategory = "report" | "research" | "code" | "automation";

export type DashboardOutput = { id: string; title: string; type: string; taskId: string };

type OutputRef = DashboardOutput | null;

export interface DashboardTaskItem {
  taskId: string;
  title: string;
  status: string;
  stateView: WorkItemStateView;
  priority: string;
  scheduleStatus: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  dueAt: string | null;
  reason: string | null;
  stage: string | null;
  nextStep: DashboardNextStep;
  latestOutput: OutputRef;
  updatedAt: string | null;
}

export type DashboardFocusTask = DashboardTaskItem;

export interface DashboardAttentionItem {
  taskId: string;
  title: string;
  status: string;
  stateView: WorkItemStateView;
  priority: string;
  kind: DashboardAttentionKind;
  reason: string | null;
  nextStep: DashboardNextStep;
  latestOutput: OutputRef;
  updatedAt: string | null;
}

export interface DashboardInProgressItem {
  taskId: string;
  title: string;
  status: string;
  stateView: WorkItemStateView;
  latestRunStatus: string | null;
  stage: string | null;
  nextStep: DashboardNextStep;
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

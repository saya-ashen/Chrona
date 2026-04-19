import type { Prisma } from "@/generated/prisma/client";
import type { ScheduleTaskListItem } from "@/components/schedule/schedule-task-list";
import type { TaskConfigRuntimeAdapter } from "@/components/schedule/task-config-form";

export type SchedulePageSummary = {
  scheduledCount: number;
  unscheduledCount: number;
  proposalCount: number;
  riskCount: number;
};

export type SchedulePlanningSummary = {
  scheduledMinutes: number;
  runnableQueueCount: number;
  conflictCount: number;
  overloadedDayCount: number;
  proposalCount: number;
  riskCount: number;
  todayLoadMinutes: number;
  overdueCount: number;
  atRiskCount: number;
  readyToScheduleCount: number;
  autoRunnableCount: number;
  waitingOnUserCount: number;
  dueSoonUnscheduledCount: number;
  largestIdleWindowMinutes: number;
  overloadedMinutes: number;
};

export type ScheduleFocusZone = {
  dayKey: string;
  totalMinutes: number;
  deepWorkMinutes: number;
  fragmentedMinutes: number;
  riskLevel: "low" | "medium" | "high";
};

export type ScheduleAutomationCandidate = {
  taskId: string;
  kind: "auto_schedule" | "decompose" | "remind" | "auto_run";
  reason: string;
  priority: "low" | "medium" | "high";
};

export type ScheduleSubtask = {
  id: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  persistedStatus: string;
  scheduleStatus: string | null;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  completedAt: Date | null;
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ScheduleRuntimeFields = {
  parentTaskId: string | null;
  runtimeAdapterKey: string | null;
  runtimeInput: unknown;
  runtimeInputVersion: string | null;
  runtimeModel: string | null;
  prompt: string | null;
  runtimeConfig: unknown;
  isRunnable: boolean;
  runnabilityState: string;
  runnabilitySummary: string;
};

export type ScheduleRecord = {
  taskId: string;
  workspaceId: string;
  title: string;
  description: string | null;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  persistedStatus: string;
  displayState: string | null;
  actionRequired: string | null;
  approvalPendingCount: number;
  scheduleStatus: string | null;
  scheduleSource: string | null;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  latestRunStatus: string | null;
  scheduleProposalCount: number;
  lastActivityAt: Date | null;
} & ScheduleRuntimeFields;

export type ScheduleProposal = {
  proposalId: string;
  taskId: string;
  workspaceId: string;
  title: string;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  source: string;
  proposedBy: string;
  summary: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

export type SchedulePageData = {
  defaultRuntimeAdapterKey: string;
  runtimeAdapters: TaskConfigRuntimeAdapter[];
  summary: SchedulePageSummary;
  planningSummary: SchedulePlanningSummary;
  focusZones: ScheduleFocusZone[];
  automationCandidates: ScheduleAutomationCandidate[];
  scheduled: ScheduleRecord[];
  unscheduled: ScheduleRecord[];
  proposals: ScheduleProposal[];
  risks: ScheduleRecord[];
  listItems: ScheduleTaskListItem[];
  conflicts: ScheduleConflict[];
  suggestions: ScheduleSuggestion[];
};

export type SchedulePageProps = {
  workspaceId: string;
  data: SchedulePageData;
};

export type ScheduleCardItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  priority: string;
  ownerType: string;
  assigneeAgentId: string | null;
  persistedStatus?: string;
  scheduleStatus?: string | null;
  scheduleSource?: string | null;
  actionRequired?: string | null;
  approvalPendingCount?: number;
  latestRunStatus?: string | null;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  runtimeAdapterKey?: string | null;
  runtimeInput?: unknown;
  runtimeInputVersion?: string | null;
  runtimeModel?: string | null;
  prompt?: string | null;
  runtimeConfig?: unknown;
  isRunnable?: boolean;
  runnabilityState?: string;
  runnabilitySummary?: string;
};

export type ScheduledItem = SchedulePageData["scheduled"][number];
export type UnscheduledItem = SchedulePageData["unscheduled"][number];
export type ListItem = SchedulePageData["listItems"][number];
export type ScheduleViewMode = "timeline" | "list";
export type SecondaryPlanningView = "queue" | "risks" | "proposals" | "conflicts";

/**
 * 冲突类型
 */
export type ConflictType =
  | "time_overlap"
  | "overload"
  | "fragmentation"
  | "dependency";

/**
 * 冲突严重程度
 */
export type ConflictSeverity = "low" | "medium" | "high";

/**
 * 冲突详情
 */
export type ScheduleConflict = {
  id: string;
  type: ConflictType;
  severity: ConflictSeverity;
  taskIds: string[];
  description: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
  metadata?: Record<string, unknown>;
};

/**
 * 建议类型
 */
export type SuggestionType =
  | "reschedule"
  | "split"
  | "merge"
  | "defer"
  | "reorder";

/**
 * 任务变更
 */
export type TaskChange = {
  taskId: string;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
  priority?: string;
  dueAt?: Date;
};

/**
 * 建议详情
 */
export type ScheduleSuggestion = {
  id: string;
  conflictId: string;
  type: SuggestionType;
  description: string;
  reason: string;
  affectedTaskIds: string[];
  changes: TaskChange[];
  estimatedImpact: {
    resolvedConflicts: number;
    movedTasks: number;
    timeShiftMinutes: number;
  };
};

export type TodayFocusItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  reason: string;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
};

export type ScheduledDayGroup = {
  key: string;
  date: Date;
  label: string;
  items: ScheduledItem[];
  proposalCount: number;
  riskCount: number;
};

export type CompressedTimelineHour = {
  hour: number;
  startMinute: number;
  endMinute: number;
  visualStart: number;
  visualHeight: number;
  active: boolean;
};

export type DragPreview = {
  top: number;
  height: number;
  startMinute: number;
  endMinute: number;
  startAt: Date;
  endAt: Date;
};

export type TimelineInteractionMode = "idle" | "dragging" | "resizing" | "creating";

export type TimelineResizeEdge = "end";

export type TimelinePlacementPreview = {
  top: number;
  height: number;
  startMinute: number;
  endMinute: number;
  startAt: Date;
  endAt: Date;
  hasConflict: boolean;
  conflictingTaskIds: string[];
  source: "drag" | "resize" | "create";
};

export type TimelineResizeDraft = TimelinePlacementPreview & {
  taskId: string;
  edge: TimelineResizeEdge;
};

export type TimelineDragItem = {
  kind: "queue" | "scheduled";
  taskId: string;
  title: string;
  dueAt: Date | null | undefined;
  durationMinutes: number;
};

export type TimelineCreateInput = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  runtimeAdapterKey: string;
  runtimeInput: Prisma.InputJsonObject;
  runtimeInputVersion: string;
  runtimeModel: string | null;
  prompt: string | null;
  dueAt: Date | null;
  runtimeConfig?: Prisma.InputJsonObject | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

export type QuickCreateDraft = {
  title: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  priority: "Low" | "Medium" | "High" | "Urgent";
};

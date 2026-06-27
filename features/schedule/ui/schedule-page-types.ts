import type { ScheduleTaskListItem } from "./schedule-task-list";
import type { TaskConfigExecutionRuntime } from "./forms/task-config-form";
import type { TaskPlanReadModel } from "@chrona/contracts/ai";
import type { AutomationTimingPreset } from "@chrona/contracts";

type SchedulePageSummary = {
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

type ScheduleFocusZone = {
  dayKey: string;
  totalMinutes: number;
  deepWorkMinutes: number;
  fragmentedMinutes: number;
  riskLevel: "low" | "medium" | "high";
};

type ScheduleAutomationCandidate = {
  taskId: string;
  kind: "auto_schedule" | "generate_plan" | "remind" | "auto_run";
  reason: string;
  priority: "low" | "medium" | "high";
  scheduledStartAt?: Date | null;
  executionMode?: "automatic" | "manual" | "hybrid" | "child_task" | "none";
  sessionStrategy?: "shared" | "per_subtask";
  readyNodeIds?: string[];
};

type ScheduleRuntimeFields = {
  parentTaskId: string | null;
  executionRuntime: string;
  executionConfig: unknown;
  isRunnable: boolean;
  runnabilityState: string;
  runnabilitySummary: string;
};

/** Frontend-friendly alias for the canonical TaskPlanReadModel from @chrona/contracts */
export type ScheduledAiTaskPlan = TaskPlanReadModel;

export type ScheduleTaskPlanSnapshot = Pick<
  TaskPlanReadModel,
  "id" | "status" | "revision" | "summary" | "updatedAt" | "generatedBy"
>;

export type ScheduleAiPlanGenerationStatus =
  | "idle"
  | "generating"
  | "waiting_acceptance"
  | "accepted";

export type ScheduleRecord = {
  taskId: string;
  workBlockId?: string;
  workspaceId: string;
  title: string;
  description: string | null;
  priority: string;
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
  autoPlanGeneration: boolean;
  autoExecute: boolean;
  autoPlanGenerationTiming: string;
  autoExecuteTiming: string;
  sourceManaged?: {
    source: "external_calendar";
    eventId: string;
    sourceName: string;
    sourceColor: string;
    description: string | null;
    immutableFields: readonly ["title", "scheduledStartAt", "scheduledEndAt"];
  } | null;
  savedPlan?: ScheduleTaskPlanSnapshot | null;
  aiPlanGenerationStatus?: ScheduleAiPlanGenerationStatus;
  autoStartEligible?: boolean;
  autoStartReason?: string | null;
} & ScheduleRuntimeFields;

type ScheduleProposal = {
  proposalId: string;
  taskId: string;
  workspaceId: string;
  title: string;
  priority: string;
  source: string;
  proposedBy: string;
  summary: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
};

type WorkBlockInfo = {
  id: string;
  taskId: string;
  planId: string | null;
  title: string;
  status: "Scheduled" | "Active" | "Completed" | "Cancelled";
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  startedAt: Date | null;
  trigger: "scheduled" | "manual";
};

export type SchedulePageData = {
  defaultExecutionRuntime: string;
  executionRuntimes: TaskConfigExecutionRuntime[];
  summary: SchedulePageSummary;
  planningSummary: SchedulePlanningSummary;
  focusZones: ScheduleFocusZone[];
  automationCandidates: ScheduleAutomationCandidate[];
  scheduled: ScheduleRecord[];
  unscheduled: ScheduleRecord[];
  proposals: ScheduleProposal[];
  risks: ScheduleRecord[];
  listItems: ScheduleTaskListItem[];
  workBlocks: WorkBlockInfo[];
};

export type SchedulePageProps = {
  workspaceId: string;
  data: SchedulePageData;
  showNewTask?: boolean;
};

export type ScheduleCardItem = {
  taskId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  priority: string;
  persistedStatus?: string;
  scheduleStatus?: string | null;
  scheduleSource?: string | null;
  actionRequired?: string | null;
  approvalPendingCount?: number;
  latestRunStatus?: string | null;
  dueAt?: Date | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  executionRuntime?: string;
  executionConfig?: unknown;
  isRunnable?: boolean;
  runnabilityState?: string;
  runnabilitySummary?: string;
  autoPlanGeneration?: boolean;
  autoExecute?: boolean;
  savedPlan?: ScheduleTaskPlanSnapshot | null;
  aiPlanGenerationStatus?: ScheduleAiPlanGenerationStatus;
  autoStartEligible?: boolean;
  autoStartReason?: string | null;
};

export type ScheduledItem = SchedulePageData["scheduled"][number];
export type UnscheduledItem = SchedulePageData["unscheduled"][number];
export type ListItem = SchedulePageData["listItems"][number];
export type ScheduleViewMode = "timeline" | "list";
export type SecondaryPlanningView =
  | "queue"
  | "risks"
  | "proposals";

/**
 * Conflict type.
 */
type ConflictType =
  | "time_overlap"
  | "overload"
  | "fragmentation"
  | "dependency";

/**
 * Conflict severity.
 */
type ConflictSeverity = "low" | "medium" | "high";

/**
 * Conflict details.
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
 * Suggestion type.
 */
type SuggestionType = "reschedule" | "split" | "merge" | "defer" | "reorder";

/**
 * Task change.
 */
type TaskChange = {
  taskId: string;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
  priority?: string;
  dueAt?: Date;
};

/**
 * Suggestion details.
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

export type TimelineInteractionMode =
  | "idle"
  | "dragging"
  | "resizing"
  | "creating";

type TimelineResizeEdge = "end";

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
  workBlockId?: string;
  title: string;
  dueAt: Date | null | undefined;
  durationMinutes: number;
};

export type TimelineCreateInput = {
  title: string;
  description: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  executionRuntime: string;
  executionConfig: RuntimeInput;
  autoExecute: boolean;
  autoPlanGenerationEnabled: boolean;
  autoPlanGenerationTiming: AutomationTimingPreset;
  autoExecuteTiming: AutomationTimingPreset;
  dueAt: Date | null;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  recurrenceRule?: string | null;
  recurrenceAnchorStartAt?: string | null;
  recurrenceAnchorEndAt?: string | null;
};

export type QuickCreateDraft = {
  title: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  priority: "Low" | "Medium" | "High" | "Urgent";
};

import type { RuntimeInput } from "@chrona/runtime-core";

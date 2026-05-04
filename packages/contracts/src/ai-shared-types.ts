import type { TaskPlanNode } from "./ai-plan-runtime";

export interface StructuredSuggestion {
  id: string;
  summary: string;
  action: {
    type: "create_task";
    title: string;
    description: string;
    priority: "Low" | "Medium" | "High" | "Urgent";
    estimatedMinutes: number;
    tags: string[];
    scheduledStartAt?: string;
    scheduledEndAt?: string;
  };
}

export type ConflictType =
  | "time_overlap"
  | "overload"
  | "fragmentation"
  | "dependency";

export type ConflictSeverity = "low" | "medium" | "high";

export interface Conflict {
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
}

export type SuggestionType =
  | "reschedule"
  | "split"
  | "merge"
  | "defer"
  | "reorder";

export interface TaskChange {
  taskId: string;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
  priority?: string;
  dueAt?: Date;
}

export interface Suggestion {
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
}

export interface ConflictAnalysisResult {
  conflicts: Conflict[];
  suggestions: Suggestion[];
  summary: {
    totalConflicts: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
    affectedTaskCount: number;
  };
}

export interface ScheduledTaskInfo {
  taskId: string;
  title: string;
  priority: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt: Date | null;
  estimatedMinutes: number;
  dependencies: string[];
}

export interface TaskAutomationInput {
  taskId: string;
  title: string;
  description: string;
  priority: string;
  dueAt: Date | null;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  isRunnable: boolean;
  runnabilityState: string;
  ownerType: string;
  tags?: string[];
}

export type ExecutionMode = "immediate" | "scheduled" | "recurring" | "manual";

export interface ReminderStrategy {
  advanceMinutes: number;
  frequency: "once" | "recurring";
  channels: string[];
}

export interface AutomationSuggestion {
  executionMode: ExecutionMode;
  reminderStrategy: ReminderStrategy;
  preparationSteps: string[];
  contextSources: Array<{ type: string; description: string }>;
  confidence: "low" | "medium" | "high";
}

export interface ScheduleSlot {
  taskId: string;
  title: string;
  startAt: Date;
  endAt: Date;
}

export interface TimeslotSuggestionInput {
  taskId: string;
  title: string;
  priority: string;
  estimatedMinutes: number;
  dueAt?: Date | null;
  currentSchedule: ScheduleSlot[];
}

export interface TimeslotOptions {
  workdayStartHour?: number;
  workdayEndHour?: number;
  bufferMinutes?: number;
  maxSuggestions?: number;
}

export interface TimeslotSuggestion {
  startAt: Date;
  endAt: Date;
  score: number;
  reasons: string[];
  conflicts: string[];
}

export interface TimeslotSuggestionResult {
  suggestions: TimeslotSuggestion[];
  bestMatch: TimeslotSuggestion | null;
}

export type WorkBlockStatus = "Scheduled" | "Active" | "Completed" | "Cancelled";
export type WorkBlockTrigger = "scheduled" | "manual";

export interface WorkBlock {
  id: string;
  workspaceId: string;
  taskId: string;
  planId: string | null;
  title: string;
  status: WorkBlockStatus;
  scheduledStartAt: string;
  scheduledEndAt: string;
  startedAt: string | null;
  completedAt: string | null;
  trigger: WorkBlockTrigger;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkBlockInput {
  taskId: string;
  planId?: string | null;
  title: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  trigger?: WorkBlockTrigger;
}

export interface WorkBlockResponse {
  workBlock: WorkBlock;
  canStart: boolean;
  blockingReason: string | null;
  nextStepId: string | null;
}

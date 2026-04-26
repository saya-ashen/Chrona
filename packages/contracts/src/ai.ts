/**
 * AI feature shared contracts and DTO-like types.
 */

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

export interface GenerateTaskPlanRequest {
  taskId?: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: Date | string | null;
  estimatedMinutes?: number;
  planningPrompt?: string;
}

export type TaskPlanStatus = "draft" | "accepted" | "superseded" | "archived";
export type TaskPlanNodeType = "step" | "checkpoint" | "decision" | "user_input" | "deliverable" | "tool_action";
export type TaskPlanNodeStatus = "pending" | "in_progress" | "waiting_for_user" | "blocked" | "done" | "skipped";
export type TaskPlanEdgeType = "sequential" | "depends_on" | "branches_to" | "unblocks" | "feeds_output";
export type TaskPlanNodeExecutionMode = "automatic" | "manual" | "hybrid";
export type TaskPlanNodeBlockingReason = "needs_user_input" | "needs_approval" | "external_dependency" | null;

export type TaskPlanNode = {
  id: string;
  type: TaskPlanNodeType;
  title: string;
  objective: string;
  description: string | null;
  status: TaskPlanNodeStatus;
  phase: string | null;
  estimatedMinutes: number | null;
  priority: "Low" | "Medium" | "High" | "Urgent" | null;
  executionMode: TaskPlanNodeExecutionMode;
  requiresHumanInput: boolean;
  requiresHumanApproval: boolean;
  autoRunnable: boolean;
  blockingReason: TaskPlanNodeBlockingReason;
  linkedTaskId: string | null;
  completionSummary: string | null;
  metadata: Record<string, unknown> | null;
};

export type TaskPlanEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: TaskPlanEdgeType;
  metadata: Record<string, unknown> | null;
};

export type TaskPlanGraph = {
  id: string;
  taskId: string;
  status: TaskPlanStatus;
  revision: number;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  prompt: string | null;
  summary: string | null;
  changeSummary: string | null;
  createdAt: string;
  updatedAt: string;
  nodes: TaskPlanNode[];
  edges: TaskPlanEdge[];
};

export interface SavedTaskPlanGraph {
  id: string;
  taskId: string | null;
  workspaceId: string;
  status: TaskPlanStatus;
  prompt: string | null;
  revision: number;
  summary: string | null;
  changeSummary: string | null;
  source: "ai" | "user" | "mixed";
  generatedBy: string | null;
  plan: TaskPlanGraph;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPlanGraphResponse {
  source: "saved" | string;
  planGraph: TaskPlanGraph;
  taskSessionKey?: string | null;
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
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

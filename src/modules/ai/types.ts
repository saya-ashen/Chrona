/**
 * AI 功能相关的类型定义
 */

/**
 * 冲突类型
 */
export type ConflictType =
  | "time_overlap" // 时间重叠
  | "overload" // 工作量过载
  | "fragmentation" // 碎片化
  | "dependency"; // 依赖关系冲突

/**
 * 冲突严重程度
 */
export type ConflictSeverity = "low" | "medium" | "high";

/**
 * 冲突详情
 */
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

/**
 * 建议类型
 */
export type SuggestionType =
  | "reschedule" // 重新安排时间
  | "split" // 拆分任务
  | "merge" // 合并任务
  | "defer" // 延后任务
  | "reorder"; // 调整顺序

/**
 * 任务变更
 */
export interface TaskChange {
  taskId: string;
  scheduledStartAt?: Date;
  scheduledEndAt?: Date;
  priority?: string;
  dueAt?: Date;
}

/**
 * 建议详情
 */
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

/**
 * 冲突分析结果
 */
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

/**
 * 调度任务信息（用于冲突检测）
 */
export interface ScheduledTaskInfo {
  taskId: string;
  title: string;
  priority: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  dueAt: Date | null;
  estimatedMinutes: number;
  dependencies: string[]; // 依赖的任务 ID 列表
}

// --- Automation Suggester Types ---

/**
 * 自動化提案の入力タスク情報
 */
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

/**
 * 実行モード
 */
export type ExecutionMode = "immediate" | "scheduled" | "recurring" | "manual";

/**
 * リマインダー戦略
 */
export interface ReminderStrategy {
  advanceMinutes: number;
  frequency: "once" | "recurring";
  channels: string[];
}

/**
 * 自動化提案の結果
 */
export interface AutomationSuggestion {
  executionMode: ExecutionMode;
  reminderStrategy: ReminderStrategy;
  preparationSteps: string[];
  contextSources: Array<{ type: string; description: string }>;
  confidence: "low" | "medium" | "high";
}

// --- Task Plan Generation Types ---

/**
 * タスクプラン生成リクエスト
 */
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

export type TaskPlanNodeType =
  | "step"
  | "checkpoint"
  | "decision"
  | "user_input"
  | "deliverable"
  | "tool_action";

export type TaskPlanNodeStatus =
  | "pending"
  | "in_progress"
  | "waiting_for_user"
  | "blocked"
  | "done"
  | "skipped";

export type TaskPlanEdgeType =
  | "sequential"
  | "depends_on"
  | "branches_to"
  | "unblocks"
  | "feeds_output";

export type TaskPlanNodeExecutionMode = "automatic" | "manual" | "hybrid";

export type TaskPlanNodeBlockingReason = 
  | "needs_user_input"
  | "needs_approval" 
  | "external_dependency"
  | null;

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
  savedPlan?: {
    id: string;
    status: TaskPlanStatus;
    prompt: string | null;
    revision: number;
    summary: string | null;
    updatedAt: string;
  };
}

// --- Timeslot Suggestion Types ---

/**
 * A scheduled slot in the calendar (existing task)
 */
export interface ScheduleSlot {
  taskId: string;
  title: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Input for the timeslot suggestion engine
 */
export interface TimeslotSuggestionInput {
  taskId: string;
  title: string;
  priority: string;
  estimatedMinutes: number;
  dueAt?: Date | null;
  currentSchedule: ScheduleSlot[];
}

/**
 * Options for timeslot suggestion
 */
export interface TimeslotOptions {
  workdayStartHour?: number; // default 9
  workdayEndHour?: number;   // default 18
  bufferMinutes?: number;    // default 15
  maxSuggestions?: number;   // default 5
}

/**
 * A single timeslot suggestion with scoring
 */
export interface TimeslotSuggestion {
  startAt: Date;
  endAt: Date;
  score: number;
  reasons: string[];
  conflicts: string[];
}

/**
 * Result of timeslot suggestion analysis
 */
export interface TimeslotSuggestionResult {
  suggestions: TimeslotSuggestion[];
  bestMatch: TimeslotSuggestion | null;
}

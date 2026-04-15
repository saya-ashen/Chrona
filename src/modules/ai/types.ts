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

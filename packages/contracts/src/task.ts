export const TASK_STATUSES = [
  "Draft",
  "Ready",
  "Queued",
  "Running",
  "WaitingForInput",
  "WaitingForApproval",
  "Scheduled",
  "Blocked",
  "Failed",
  "Completed",
  "Done",
  "Cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type ExecutionRuntime = string;

export type TaskExecutionConfig = {
  prompt?: string;
  temperature?: number;
  approvalPolicy?: "never" | "on-request" | "always";
  toolMode?: "read-only" | "workspace-write" | "full-access";
  sessionStrategy?: "shared" | "per_subtask";
};

export type TaskRuntimeFields = {
  executionRuntime: ExecutionRuntime;
  executionConfig: TaskExecutionConfig;
};

export type TaskScheduleFields = {
  dueAt: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduleStatus: string | null;
  scheduleSource: string | null;
};

export type TaskCore = {
  id: string;
  workspaceId: string;
  parentTaskId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
};

export type TaskReadModel = TaskCore &
  TaskRuntimeFields &
  TaskScheduleFields & {
    isRunnable: boolean;
    runnabilitySummary: string;
    runnabilityState?: string;
  };

export type CreateTaskInput = {
  workspaceId: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  parentTaskId?: string | null;
} & Partial<TaskRuntimeFields>;

export type UpdateTaskInput = {
  taskId: string;
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
} & Partial<TaskRuntimeFields>;

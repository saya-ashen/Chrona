import { deriveWorkItemStateView, type WorkItemStateView } from "./derive-work-item-state-view";

const AUTHORITATIVE_TERMINAL_STATES = new Set(["Completed", "Done", "Cancelled", "completed", "done", "cancelled"]);

export type TaskProjectionStateViewInput = {
  taskStatus?: string | null;
  persistedStatus?: string | null;
  scheduleStatus?: string | null;
  planStatus?: string | null;
  displayState?: string | null;
  latestRunStatus?: string | null;
  nodeStatus?: string | null;
  isScheduled?: boolean;
  hasPlan?: boolean;
  isRunnable?: boolean;
  disabledReason?: string | null;
};

export function hasTerminalAuthoritativeTaskState(input: Pick<TaskProjectionStateViewInput, "taskStatus" | "persistedStatus" | "displayState">) {
  return [input.displayState, input.persistedStatus, input.taskStatus].some((status) => status ? AUTHORITATIVE_TERMINAL_STATES.has(status) : false);
}

export function deriveTaskProjectionStateView(input: TaskProjectionStateViewInput): WorkItemStateView {
  return deriveWorkItemStateView({
    taskStatus: input.persistedStatus ?? input.taskStatus,
    scheduleStatus: input.scheduleStatus,
    planStatus: input.planStatus,
    executionStatus: input.displayState,
    providerStatus: input.latestRunStatus,
    nodeStatus: input.nodeStatus,
    isScheduled: input.isScheduled,
    hasPlan: input.hasPlan,
    isRunnable: input.isRunnable,
    disabledReason: input.disabledReason,
  });
}

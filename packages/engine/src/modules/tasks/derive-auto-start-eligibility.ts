export type AutoStartEligibility =
  | {
      ok: true;
      mode: "start_task";
    }
  | {
      ok: false;
      reason:
        | "not_scheduled"
        | "not_due"
        | "already_running"
        | "invalid_task_status"
        | "no_runtime_config"
        | "no_accepted_plan"
        | "requires_human_input"
        | "requires_approval"
        | "runtime_unsupported";
    };

export type TaskLike = {
  status: string;
  scheduleStatus: string;
  scheduledStartAt?: Date | string | null;
  runtimeAdapterKey?: string | null;
};

export type RunLike = {
  status: string;
};

const ALLOWABLE_START_STATUSES = ["Ready", "Scheduled", "Queued"] as const;

const ACTIVE_RUN_STATUSES = ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] as const;

export function deriveAutoStartEligibility(input: {
  task: TaskLike;
  now: Date;
  activeRun?: RunLike | null;
}): AutoStartEligibility {
  if (input.task.scheduleStatus !== "Scheduled" && input.task.scheduleStatus !== "Overdue") {
    return { ok: false, reason: "not_scheduled" };
  }

  const scheduledStartAt = input.task.scheduledStartAt;
  if (!scheduledStartAt) {
    return { ok: false, reason: "not_due" };
  }

  const startTime = typeof scheduledStartAt === "string" ? new Date(scheduledStartAt) : scheduledStartAt;
  if (startTime > input.now) {
    return { ok: false, reason: "not_due" };
  }

  if (!ALLOWABLE_START_STATUSES.some((s) => s === input.task.status)) {
    return { ok: false, reason: "invalid_task_status" };
  }

  const activeRun = input.activeRun;
  if (activeRun && ACTIVE_RUN_STATUSES.some((s) => s === activeRun.status)) {
    return { ok: false, reason: "already_running" };
  }

  if (!input.task.runtimeAdapterKey) {
    return { ok: false, reason: "no_runtime_config" };
  }

  return { ok: true, mode: "start_task" };
}

import { automationTimingOffsetMs, normalizeAutomationTiming } from "@chrona/contracts";

export type AutoStartSkipReason =
  | "not_scheduled"
  | "not_due"
  | "already_running"
  | "invalid_task_status"
  | "no_runtime_config"
  | "no_accepted_plan"
  | "requires_human_input"
  | "requires_approval"
  | "runtime_unsupported";

type AutoStartEligibility =
  | {
      ok: true;
      mode: "start_task";
    }
  | {
      ok: false;
      reason: AutoStartSkipReason;
      disabledReason: string;
    };

export type TaskLike = {
  status: string;
  executionRuntime?: string | null;
  hasAcceptedPlan?: boolean;
  autoExecuteTiming?: string | null;
};

export type WorkBlockLike = {
  scheduledStartAt?: Date | string | null;
};

export type RunLike = {
  status: string;
};

const ALLOWABLE_START_STATUSES = ["Draft", "Ready", "Scheduled", "Queued"] as const;

const ACTIVE_RUN_STATUSES = ["Pending", "Running", "WaitingForInput", "WaitingForApproval"] as const;

const AUTO_START_DISABLED_REASONS: Record<AutoStartSkipReason, string> = {
  not_scheduled: "Schedule this task before automatic execution can start.",
  not_due: "Automatic execution will start at the configured schedule time.",
  already_running: "A run is already active for this task.",
  invalid_task_status: "Only draft, ready, scheduled, or queued tasks can auto-start.",
  no_runtime_config: "Choose an execution runtime before automatic execution can start.",
  no_accepted_plan: "Accept a plan before automatic execution can start.",
  requires_human_input: "Automatic execution is paused until the requested input is provided.",
  requires_approval: "Automatic execution is paused until the approval request is resolved.",
  runtime_unsupported: "The selected runtime cannot be started automatically.",
};

function blocked(reason: AutoStartSkipReason): AutoStartEligibility {
  return { ok: false, reason, disabledReason: AUTO_START_DISABLED_REASONS[reason] };
}

export function autoStartDisabledReason(reason: AutoStartSkipReason): string {
  return AUTO_START_DISABLED_REASONS[reason];
}

export function deriveAutoStartEligibility(input: {
  task: TaskLike;
  workBlock: WorkBlockLike | null;
  now: Date;
  activeRun?: RunLike | null;
}): AutoStartEligibility {
  if (!input.workBlock) {
    return blocked("not_scheduled");
  }

  const scheduledStartAt = input.workBlock.scheduledStartAt;
  if (!scheduledStartAt) {
    return blocked("not_due");
  }

  const startTime = typeof scheduledStartAt === "string" ? new Date(scheduledStartAt) : scheduledStartAt;
  const timing = normalizeAutomationTiming(input.task.autoExecuteTiming);
  const triggerTime =
    timing === "immediate"
      ? startTime
      : new Date(startTime.getTime() - automationTimingOffsetMs(timing));
  if (triggerTime > input.now) {
    return blocked("not_due");
  }

  if (!ALLOWABLE_START_STATUSES.some((s) => s === input.task.status)) {
    return blocked("invalid_task_status");
  }

  const activeRun = input.activeRun;
  if (activeRun && ACTIVE_RUN_STATUSES.some((s) => s === activeRun.status)) {
    return blocked("already_running");
  }

  if (!input.task.executionRuntime) {
    return blocked("no_runtime_config");
  }

  if (!input.task.hasAcceptedPlan) {
    return blocked("no_accepted_plan");
  }

  return { ok: true, mode: "start_task" };
}

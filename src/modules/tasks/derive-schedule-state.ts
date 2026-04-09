type DeriveScheduleStateInput = {
  task: {
    dueAt: Date | null;
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
    scheduleSource: string | null;
  };
  latestRun:
    | {
        status: string;
        startedAt: Date | null;
        endedAt: Date | null;
      }
    | null;
  now: Date;
};

type DeriveScheduleStateResult = {
  scheduleStatus:
    | "Unscheduled"
    | "Scheduled"
    | "InProgress"
    | "AtRisk"
    | "Interrupted"
    | "Overdue"
    | "Completed";
  scheduleSummary: string;
};

export function deriveScheduleState(
  input: DeriveScheduleStateInput,
): DeriveScheduleStateResult {
  const { dueAt, scheduledStartAt, scheduledEndAt } = input.task;
  const latestRun = input.latestRun;
  const hasAnySchedule = Boolean(dueAt || scheduledStartAt || scheduledEndAt);

  if (!hasAnySchedule) {
    return {
      scheduleStatus: "Unscheduled",
      scheduleSummary: "Needs scheduling",
    };
  }

  if (latestRun?.status === "Completed") {
    return {
      scheduleStatus: "Completed",
      scheduleSummary: "Execution finished",
    };
  }

  if (latestRun?.status === "Failed") {
    return {
      scheduleStatus: "Interrupted",
      scheduleSummary: "Execution failed and requires recovery",
    };
  }

  if (
    latestRun?.status === "WaitingForApproval" ||
    latestRun?.status === "WaitingForInput"
  ) {
    return {
      scheduleStatus: "AtRisk",
      scheduleSummary: "Execution is blocked and threatens the plan",
    };
  }

  if (
    latestRun?.status === "Running" &&
    ((scheduledEndAt && input.now > scheduledEndAt) || (dueAt && input.now > dueAt))
  ) {
    return {
      scheduleStatus: "Overdue",
      scheduleSummary: "Execution has exceeded the planned window",
    };
  }

  if (latestRun?.status === "Running" || latestRun?.status === "Pending") {
    return {
      scheduleStatus: "InProgress",
      scheduleSummary: "Execution is active against the current plan",
    };
  }

  if ((scheduledEndAt && input.now > scheduledEndAt) || (dueAt && input.now > dueAt)) {
    return {
      scheduleStatus: "Overdue",
      scheduleSummary: "Execution has exceeded the planned window",
    };
  }

  return {
    scheduleStatus: "Scheduled",
    scheduleSummary: "Scheduled but not yet in progress",
  };
}

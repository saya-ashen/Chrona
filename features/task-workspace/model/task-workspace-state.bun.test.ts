import { describe, expect, it } from "bun:test";
import { deriveTaskProjectionStateView } from "@chrona/domain";
import { stateViewForWorkspaceStatus } from "./task-workspace-state";

function scheduleStateView(input: {
  persistedStatus: string;
  displayState?: string | null;
  scheduleStatus?: string | null;
  latestRunStatus?: string | null;
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
  isRunnable?: boolean;
  actionRequired?: string | null;
  aiPlanGenerationStatus?: "idle" | "generating" | "waiting_acceptance" | "accepted";
}) {
  return deriveTaskProjectionStateView({
    persistedStatus: input.persistedStatus,
    scheduleStatus: input.scheduleStatus,
    planStatus: input.aiPlanGenerationStatus,
    displayState: input.displayState,
    latestRunStatus: input.latestRunStatus,
    isScheduled: Boolean(input.scheduledStartAt || input.scheduledEndAt),
    isRunnable: input.isRunnable,
    disabledReason: input.actionRequired,
  });
}

function taskListStateView(input: {
  taskStatus: string;
  scheduleStatus?: string | null;
  displayState?: string | null;
  latestRunStatus?: string | null;
  isScheduled?: boolean;
  isRunnable?: boolean;
  actionRequired?: string | null;
}) {
  return deriveTaskProjectionStateView({
    taskStatus: input.taskStatus,
    scheduleStatus: input.scheduleStatus,
    displayState: input.displayState,
    latestRunStatus: input.latestRunStatus,
    isScheduled: input.isScheduled,
    isRunnable: input.isRunnable,
    disabledReason: input.actionRequired,
  });
}

describe("work item state cross-surface consistency", () => {
  it.each([
    {
      name: "waiting input",
      taskStatus: "WaitingForInput",
      scheduleStatus: "Interrupted",
      latestRunStatus: "WaitingForInput",
      expected: {
        state: "waiting_for_input",
        label: "Waiting for input",
        severity: "warning",
        primaryAction: "provide_input",
      },
    },
    {
      name: "waiting approval",
      taskStatus: "WaitingForApproval",
      scheduleStatus: "Interrupted",
      latestRunStatus: "WaitingForApproval",
      expected: {
        state: "waiting_for_approval",
        label: "Waiting for approval",
        severity: "warning",
        primaryAction: "review_approval",
      },
    },
    {
      name: "failed",
      taskStatus: "Failed",
      scheduleStatus: "Interrupted",
      latestRunStatus: "Failed",
      expected: {
        state: "failed",
        label: "Failed",
        severity: "danger",
        primaryAction: "retry",
      },
    },
    {
      name: "running",
      taskStatus: "Running",
      scheduleStatus: "InProgress",
      latestRunStatus: "Running",
      expected: {
        state: "running",
        label: "Running",
        severity: "info",
        primaryAction: "open_execution",
      },
    },
  ])("uses same state view for $name", ({ taskStatus, scheduleStatus, latestRunStatus, expected }) => {
    const schedule = scheduleStateView({
      persistedStatus: taskStatus,
      scheduleStatus,
      latestRunStatus,
      scheduledStartAt: new Date("2026-07-03T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-07-03T10:00:00.000Z"),
      isRunnable: true,
    });
    const taskList = taskListStateView({
      taskStatus,
      scheduleStatus,
      latestRunStatus,
      isScheduled: true,
      isRunnable: true,
    });
    const workspace = stateViewForWorkspaceStatus({
      taskStatus,
      scheduleStatus,
      latestRunStatus,
      isScheduled: true,
      isRunnable: true,
    });

    for (const view of [schedule, taskList, workspace]) {
      expect(view.state).toBe(expected.state);
      expect(view.label).toBe(expected.label);
      expect(view.severity).toBe(expected.severity);
      expect(view.primaryAction).toBe(expected.primaryAction);
    }
  });

  it("keeps disabled reason consistent and clears primary action", () => {
    const disabledReason = "Provider missing";
    const schedule = scheduleStateView({
      persistedStatus: "Ready",
      scheduleStatus: "Scheduled",
      latestRunStatus: null,
      scheduledStartAt: new Date("2026-07-03T09:00:00.000Z"),
      scheduledEndAt: new Date("2026-07-03T10:00:00.000Z"),
      isRunnable: false,
      actionRequired: disabledReason,
    });
    const taskList = taskListStateView({
      taskStatus: "Ready",
      scheduleStatus: "Scheduled",
      latestRunStatus: null,
      isScheduled: true,
      isRunnable: false,
      actionRequired: disabledReason,
    });
    const workspace = stateViewForWorkspaceStatus({
      taskStatus: "Ready",
      scheduleStatus: "Scheduled",
      isScheduled: true,
      isRunnable: false,
      disabledReason,
    });

    for (const view of [schedule, taskList, workspace]) {
      expect(view.state).toBe("blocked");
      expect(view.disabledReason).toBe(disabledReason);
      expect(view.primaryAction).toBeNull();
    }
  });
});

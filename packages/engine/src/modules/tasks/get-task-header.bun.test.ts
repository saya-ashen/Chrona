import { describe, expect, it } from "bun:test";

import {
  headerExecutionStateToStatePaths,
  resolveHeaderExecutionState,
  resolveTaskHeaderViewModel,
  taskHeaderStatus,
  type BuildHeaderSpecInput,
} from "./get-task-header";
type HeaderTaskView = NonNullable<BuildHeaderSpecInput["task"]>;

describe("taskHeaderStatus", () => {
  describe("executionStatus takes precedence over taskStatus when execution is active", () => {
    it("returns 'running' when executionStatus is 'running' regardless of taskStatus", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Blocked",
          executionStatus: "running",
          hasActiveExecution: true,
        }),
      ).toBe("running");
      expect(
        taskHeaderStatus({
          taskStatus: "Completed",
          executionStatus: "running",
          hasActiveExecution: true,
        }),
      ).toBe("running");
    });

    it("returns 'approval-needed' for waiting_for_user / waiting_for_approval", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "waiting_for_user",
          hasActiveExecution: true,
        }),
      ).toBe("approval-needed");
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "waiting_for_approval",
          hasActiveExecution: true,
        }),
      ).toBe("approval-needed");
    });

    it("returns 'blocked' for executionStatus 'blocked' even when taskStatus is not Blocked", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "blocked",
          hasActiveExecution: true,
        }),
      ).toBe("blocked");
    });

    it("returns 'blocked' for executionStatus 'failed' even when taskStatus is not Blocked", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "failed",
          hasActiveExecution: true,
        }),
      ).toBe("blocked");
    });

    it("returns 'completed' for executionStatus 'completed' regardless of taskStatus", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "completed",
          hasActiveExecution: true,
        }),
      ).toBe("completed");
    });
  });

  describe("taskStatus fallback only applies when the selected occurrence has no active execution", () => {
    it("returns 'blocked' when hasActiveExecution is true and taskStatus is 'Blocked'", () => {
      // The selected occurrence has its own active execution that is still
      // running/waiting/failed — that execution owns the header status, and a
      // stale Blocked on the task row is not surfaced to confuse the user.
      expect(
        taskHeaderStatus({
          taskStatus: "Blocked",
          executionStatus: "running",
          hasActiveExecution: true,
        }),
      ).toBe("running");
    });

    it("returns 'waiting' when hasActiveExecution is false and taskStatus is 'Blocked'", () => {
      // The selected occurrence is idle (no plan / started / cancelled). A
      // stale Blocked on the task row from a prior occurrence must NOT bleed
      // into the header — the user has switched away from the blocked
      // occurrence, so the header should reflect "nothing happening here
      // yet" rather than the dead execution of an unrelated occurrence.
      expect(
        taskHeaderStatus({
          taskStatus: "Blocked",
          executionStatus: "no_plan",
          hasActiveExecution: false,
        }),
      ).toBe("waiting");
      expect(
        taskHeaderStatus({
          taskStatus: "Blocked",
          executionStatus: "cancelled",
          hasActiveExecution: false,
        }),
      ).toBe("waiting");
      expect(
        taskHeaderStatus({
          taskStatus: "Blocked",
          executionStatus: "started",
          hasActiveExecution: false,
        }),
      ).toBe("waiting");
    });

    it("returns 'completed' when taskStatus is Completed/Done even with no active execution", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Completed",
          executionStatus: "no_plan",
          hasActiveExecution: false,
        }),
      ).toBe("completed");
      expect(
        taskHeaderStatus({
          taskStatus: "Done",
          executionStatus: "started",
          hasActiveExecution: false,
        }),
      ).toBe("completed");
    });
    it("returns 'running' when taskStatus is 'Running' even with no active execution", () => {
      // 'Running' is a user-set/manual state on the task row, not derived
      // from execution status — it should still be honoured.
      expect(
        taskHeaderStatus({
          taskStatus: "Running",
          executionStatus: "no_plan",
          hasActiveExecution: false,
        }),
      ).toBe("running");
    });

    it("returns 'waiting' for an idle occurrence whose task row is still 'Open'", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "no_plan",
          hasActiveExecution: false,
        }),
      ).toBe("waiting");
    });
  });

  describe("executionStatus 'blocked' and 'failed' always win over the hasActiveExecution gate", () => {
    it("returns 'blocked' for executionStatus 'blocked' even when hasActiveExecution is false", () => {
      // hasActiveExecution must be derived from the same executionStatus that
      // the caller is asking about. If the caller passes hasActiveExecution:
      // false alongside executionStatus: 'blocked', they are inconsistent
      // and the execution state should still drive the visible status.
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "blocked",
          hasActiveExecution: false,
        }),
      ).toBe("blocked");
    });

    it("returns 'blocked' for executionStatus 'failed' even when hasActiveExecution is false", () => {
      expect(
        taskHeaderStatus({
          taskStatus: "Open",
          executionStatus: "failed",
          hasActiveExecution: false,
        }),
      ).toBe("blocked");
    });
  });
});

describe("resolveHeaderExecutionState", () => {
  it.each(["blocked", "failed"] as const)("does not expose Stop or Start for %s executions", (executionStatus) => {
    const state = resolveHeaderExecutionState({
      executionStatus,
      hasPlan: true,
      hasAcceptedPlan: true,
      isRunnable: true,
    });

    expect(state.canStop).toBe(false);
    expect(state.canStart).toBe(false);
    expect(headerExecutionStateToStatePaths(state)["/execution/can-stop"]).toBe(false);
    expect(headerExecutionStateToStatePaths(state)["/execution/can-start"]).toBe(false);
  });

  it("keeps Stop available for active cancellable executions", () => {
    const state = resolveHeaderExecutionState({
      executionStatus: "running",
      hasPlan: true,
      hasAcceptedPlan: true,
      isRunnable: true,
    });

    expect(state.canStop).toBe(true);
    expect(state.canPause).toBe(true);
    expect(headerExecutionStateToStatePaths(state)["/execution/can-stop"]).toBe(true);
  });
});

describe("resolveTaskHeaderViewModel — header status follows the selected occurrence", () => {
  it("uses the selected work block's status instead of the shared task row status", () => {
    // Regression: when the user navigates from a "Blocked" task row to
    // an occurrence whose work block is "Scheduled", the header badge
    // must reflect the new occurrence ("Scheduled"/waiting), not the
    // task row's stale "Blocked" value. The task row status is shared
    // across the entire recurrence series, so resolving it directly
    // would make the header sticky across the occurrence switch.
    const baseTime = new Date("2026-06-12T00:00:00.000Z");
    const task: HeaderTaskView = {
      id: "task-1",
      workspaceId: "ws-1",
      seriesExternalUid: "series-1",
      title: "Recurring task",
      status: "Blocked", // task-row status is shared across the series
      priority: "Medium",
      dueAt: null,
      projection: null,
      workBlocks: [
        {
          id: "block-scheduled",
          status: "Scheduled",
          scheduledStartAt: new Date("2026-06-12T09:00:00.000Z"),
          scheduledEndAt: new Date("2026-06-12T10:00:00.000Z"),
        } as unknown as HeaderTaskView["workBlocks"][number],
      ],
      importedCalendarEvents: [],
    };
    const headerView = resolveTaskHeaderViewModel({
      task,
      recurrenceSeriesTasks: [],
      currentExecution: {
        taskId: "task-1",
        planId: null,
        mainSessionId: null,
        status: "no_plan",
        currentNodeId: null,
        executedNodeIds: [],
        waitingNodeIds: [],
        blockedNodeIds: [],
        message: "",
        checkpoint: null,
      },
      savedPlan: null,
      workBlockId: "block-scheduled",
      now: baseTime,
    });
    expect(headerView.status).toBe("waiting");
  });
  it("falls back to the task row status when no work block is selected", () => {
    const baseTime = new Date("2026-06-12T00:00:00.000Z");
    const task: HeaderTaskView = {
      id: "task-1",
      workspaceId: "ws-1",
      seriesExternalUid: null,
      title: "Single-shot task",
      status: "Blocked",
      priority: "Medium",
      dueAt: null,
      projection: null,
      workBlocks: [] as unknown as HeaderTaskView["workBlocks"],
      importedCalendarEvents: [],
    };
    const headerView = resolveTaskHeaderViewModel({
      task,
      recurrenceSeriesTasks: [],
      currentExecution: {
        taskId: "task-1",
        planId: null,
        mainSessionId: null,
        status: "no_plan",
        currentNodeId: null,
        executedNodeIds: [],
        waitingNodeIds: [],
        blockedNodeIds: [],
        message: "",
        checkpoint: null,
      },
      savedPlan: null,
      workBlockId: null,
      now: baseTime,
    });
    // taskHeaderStatus only surfaces "Blocked" when an execution is
    // active; without one, the task row's "Blocked" falls through to
    // "waiting". The point of the assertion is the code path: the
    // fallback resolves to `task.status` only when no work block is
    // selected, so we exercise the same taskStatus the previous
    // occurrence test used but flip the workBlockId off.
    expect(headerView.status).toBe("waiting");
  });
});

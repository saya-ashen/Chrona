import { describe, expect, it } from "bun:test";
import { deriveTaskState } from "./derive-task-state";

const updatedAt = new Date("2026-05-10T12:03:18.454Z");

describe("deriveTaskState", () => {
  it("keeps a paused execution session blocked even when the latest run is completed", () => {
    const result = deriveTaskState({
      task: { status: "Completed", latestRunId: "run_1" },
      runs: [{ id: "run_1", status: "Completed", updatedAt }],
      approvals: [],
      sync: { stale: false },
      executionSession: {
        status: "Paused",
        currentNodeId: "cn_failed_1",
        pauseReason: "manual_action",
      },
    });

    expect(result).toMatchObject({
      persistedStatus: "Blocked",
      displayState: "Attention Needed",
      blockReason: {
        blockType: "node_blocked",
        scope: "plan_node",
        actionRequired: "Check execution status",
      },
    });
  });

  it("keeps a completed run completed when there is no active execution session", () => {
    expect(
      deriveTaskState({
        task: { status: "Running", latestRunId: "run_1" },
        runs: [{ id: "run_1", status: "Completed", updatedAt }],
        approvals: [],
        sync: { stale: false },
        executionSession: null,
      }),
    ).toMatchObject({
      persistedStatus: "Completed",
      displayState: null,
      blockReason: null,
    });
  });

  it("preserves external dependency pause reason in the task block reason", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_1" },
      runs: [{ id: "run_1", status: "Completed", updatedAt }],
      approvals: [],
      sync: { stale: false },
      executionSession: {
        status: "Paused",
        currentNodeId: "cn_external_1",
        pauseReason: "external_dependency",
      },
    });

    expect(result).toMatchObject({
      persistedStatus: "Blocked",
      displayState: "Attention Needed",
      blockReason: {
        blockType: "external_dependency",
        scope: "plan_node",
        actionRequired: "Resume after external dependency is resolved",
      },
    });
  });

  it("clears a failed-run block once the retry session is actively executing", () => {
    const result = deriveTaskState({
      task: { status: "Blocked", latestRunId: "run_1" },
      runs: [{ id: "run_1", status: "Failed", updatedAt }],
      approvals: [],
      sync: { stale: false },
      executionSession: {
        status: "Active",
        currentNodeId: "cn_retry_1",
        pauseReason: null,
      },
    });

    expect(result).toMatchObject({
      persistedStatus: "Running",
      displayState: "ExecutionActive",
      blockReason: null,
      blockSince: null,
    });
  });

  it("still reports a failed run as blocked when no session is active", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_1" },
      runs: [{ id: "run_1", status: "Failed", updatedAt }],
      approvals: [],
      sync: { stale: false },
      executionSession: null,
    });

    expect(result).toMatchObject({
      persistedStatus: "Blocked",
      blockReason: { blockType: "run_failed", scope: "run", actionRequired: "Retry Run" },
    });
  });

  it("surfaces the real provider error and paused node in a failed-run block", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_1" },
      runs: [
        {
          id: "run_1",
          status: "Failed",
          updatedAt,
          errorSummary: "HTTP 502: provider connect timeout",
        },
      ],
      approvals: [],
      sync: { stale: false },
      executionSession: { status: "Paused", currentNodeId: "cn_answer", pauseReason: "manual_action" },
    });

    expect(result).toMatchObject({
      persistedStatus: "Blocked",
      blockReason: {
        blockType: "run_failed",
        scope: "run",
        actionRequired: "Retry Run",
        nodeId: "cn_answer",
        detail: "HTTP 502: provider connect timeout",
      },
    });
  });

  it("reports an abandoned execution session as cancelled without a block", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_1" },
      runs: [{ id: "run_1", status: "Failed", updatedAt, errorSummary: "irrelevant once cancelled" }],
      approvals: [],
      sync: { stale: false },
      executionSession: { status: "Abandoned", currentNodeId: null, pauseReason: null },
    });

    expect(result).toMatchObject({
      persistedStatus: "Cancelled",
      blockReason: null,
      blockSince: null,
    });
  });

  it("does not let stale running runs reopen a completed task", () => {
    expect(
      deriveTaskState({
        task: { status: "Completed", latestRunId: null },
        runs: [
          { id: "run_stale", status: "Running", updatedAt: new Date("2026-05-10T12:04:18.454Z") },
          { id: "run_done", status: "Completed", updatedAt },
        ],
        approvals: [],
        sync: { stale: false },
        executionSession: null,
      }),
    ).toMatchObject({
      persistedStatus: "Completed",
      displayState: null,
      blockReason: null,
    });
  });

  it("does not report sync-stale blockers for completed tasks", () => {
    expect(
      deriveTaskState({
        task: { status: "Completed", latestRunId: "run_1" },
        runs: [{ id: "run_1", status: "Completed", updatedAt }],
        approvals: [],
        sync: { stale: true },
        executionSession: null,
      }),
    ).toMatchObject({
      persistedStatus: "Completed",
      displayState: null,
      blockReason: null,
      blockSince: null,
    });
  });
});

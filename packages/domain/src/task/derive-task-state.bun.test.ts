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
        blockType: "execution_paused",
        scope: "execution_session",
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
});

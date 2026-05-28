import { describe, expect, test } from "bun:test";
import { deriveTaskState } from "./derive-task-state";

const now = new Date("2026-05-28T10:00:00.000Z");
const later = new Date("2026-05-28T10:05:00.000Z");

function derive(overrides: Partial<Parameters<typeof deriveTaskState>[0]> = {}) {
  return deriveTaskState({
    task: { status: "Ready", latestRunId: null },
    runs: [],
    approvals: [],
    sync: { stale: false },
    executionSession: null,
    ...overrides,
  });
}

describe("task state boundaries", () => {
  test("uses latestRunId instead of most recently updated run", () => {
    const state = derive({
      task: { status: "Running", latestRunId: "waiting" },
      runs: [
        { id: "failed", status: "Failed", updatedAt: later },
        { id: "waiting", status: "WaitingForInput", updatedAt: now },
      ],
    });

    expect(state.persistedStatus).toBe("WaitingForInput");
    expect(state.blockReason).toMatchObject({ blockType: "waiting_for_input" });
    expect(state.blockSince).toEqual(now);
  });

  test("falls back to newest run when task latestRunId is absent", () => {
    const state = derive({
      runs: [
        { id: "running", status: "Running", updatedAt: now },
        { id: "failed", status: "Failed", updatedAt: later },
      ],
    });

    expect(state.persistedStatus).toBe("Blocked");
    expect(state.displayState).toBe("Attention Needed");
    expect(state.blockReason).toMatchObject({ actionRequired: "Retry Run" });
  });

  test("pending approval blocks even when no active run is waiting", () => {
    const requestedAt = new Date("2026-05-28T09:00:00.000Z");
    const state = derive({
      task: { status: "Ready", latestRunId: null },
      approvals: [{ status: "Pending", requestedAt }],
    });

    expect(state.persistedStatus).toBe("Ready");
    expect(state.blockReason).toMatchObject({ blockType: "approval_pending", scope: "task" });
    expect(state.blockSince).toEqual(requestedAt);
  });

  test("paused completed task still exposes replan review state", () => {
    const state = derive({
      task: { status: "Completed", latestRunId: "run-1" },
      runs: [{ id: "run-1", status: "Completed", updatedAt: later }],
      executionSession: { status: "Paused", currentNodeId: "review", pauseReason: "replan_required" },
    });

    expect(state.persistedStatus).toBe("WaitingForApproval");
    expect(state.blockReason).toMatchObject({
      blockType: "replan_required",
      nodeId: "review",
      actionRequired: "Review Step Output",
    });
  });
});

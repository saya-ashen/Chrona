import { describe, expect, it } from "bun:test";
import { deriveTaskState } from "@chrona/domain";

describe("deriveTaskState", () => {
  it("marks the task blocked when the active run waits for approval", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_2" },
      runs: [
        { id: "run_1", status: "Failed", updatedAt: new Date("2026-04-08T09:00:00Z") },
        { id: "run_2", status: "WaitingForApproval", updatedAt: new Date("2026-04-08T10:00:00Z") },
      ],
      approvals: [{ status: "Pending", requestedAt: new Date("2026-04-08T10:00:00Z") }],
      sync: { stale: false },
    });

    expect(result.persistedStatus).toBe("WaitingForApproval");
    expect(result.displayState).toBeNull();
    expect(result.blockReason?.actionRequired).toBe("Approve / Reject / Edit and Approve");
  });

  it("promotes waiting-for-input to a first-class persisted status", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_2" },
      runs: [
        { id: "run_1", status: "Completed", updatedAt: new Date("2026-04-08T09:00:00Z") },
        { id: "run_2", status: "WaitingForInput", updatedAt: new Date("2026-04-08T10:00:00Z") },
      ],
      approvals: [],
      sync: { stale: false },
    });

    expect(result.persistedStatus).toBe("WaitingForInput");
    expect(result.displayState).toBeNull();
    expect(result.blockReason?.actionRequired).toBe("Provide Input");
  });
  it("keeps waiting-for-input authoritative when an older run is sync-stale", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_2" },
      runs: [
        { id: "run_1", status: "Running", updatedAt: new Date("2026-04-08T09:00:00Z") },
        { id: "run_2", status: "WaitingForInput", updatedAt: new Date("2026-04-08T10:00:00Z") },
      ],
      approvals: [],
      sync: { stale: true },
    });

    expect(result.persistedStatus).toBe("WaitingForInput");
    expect(result.displayState).toBeNull();
    expect(result.blockReason).toMatchObject({
      blockType: "waiting_for_input",
      actionRequired: "Provide Input",
    });
  });

  it("keeps a canonical running run authoritative over stale sync metadata", () => {
    const result = deriveTaskState({
      task: { status: "WaitingForInput", latestRunId: "run_2" },
      runs: [
        { id: "run_1", status: "Cancelled", updatedAt: new Date("2026-04-08T09:00:00Z") },
        { id: "run_2", status: "Running", updatedAt: new Date("2026-04-08T10:00:00Z") },
      ],
      approvals: [],
      sync: { stale: true },
    });

    expect(result.persistedStatus).toBe("Running");
    expect(result.displayState).toBeNull();
    expect(result.blockReason).toBeNull();
  });

  it("lets a paused failed graph session override a stale running Run", () => {
    const result = deriveTaskState({
      task: { status: "Running", latestRunId: "run_2" },
      runs: [{
        id: "run_2",
        status: "Running",
        updatedAt: new Date("2026-04-08T10:00:00Z"),
      }],
      approvals: [],
      sync: { stale: true },
      executionSession: {
        status: "Paused",
        currentNodeId: "node_failed",
        pauseReason: "manual_action",
      },
    });

    expect(result.persistedStatus).toBe("Blocked");
    expect(result.displayState).toBe("Attention Needed");
    expect(result.blockReason).toMatchObject({
      blockType: "node_blocked",
      nodeId: "node_failed",
    });
  });

  it("ignores sync-stale blockers for completed tasks", () => {
    const result = deriveTaskState({
      task: { status: "Completed", latestRunId: "run_3" },
      runs: [{ id: "run_3", status: "Completed", updatedAt: new Date("2026-04-08T10:00:00Z") }],
      approvals: [],
      sync: { stale: true },
    });

    expect(result.persistedStatus).toBe("Completed");
    expect(result.displayState).toBeNull();
    expect(result.blockReason).toBeNull();
  });

  it("preserves done tasks instead of projecting them back to completed", () => {
    const result = deriveTaskState({
      task: { status: "Done", latestRunId: "run_3" },
      runs: [{ id: "run_3", status: "Completed", updatedAt: new Date("2026-04-08T10:00:00Z") }],
      approvals: [],
      sync: { stale: false },
    });

    expect(result.persistedStatus).toBe("Done");
    expect(result.displayState).toBeNull();
  });
});

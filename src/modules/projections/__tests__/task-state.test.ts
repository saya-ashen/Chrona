import { describe, expect, it } from "vitest";
import { deriveTaskState } from "@/modules/tasks/derive-task-state";

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

    expect(result.persistedStatus).toBe("Blocked");
    expect(result.displayState).toBe("WaitingForApproval");
    expect(result.blockReason?.actionRequired).toBe("Approve / Reject / Edit and Approve");
  });

  it("keeps sync-stale as a display state instead of overwriting the stored task status", () => {
    const result = deriveTaskState({
      task: { status: "Completed", latestRunId: "run_3" },
      runs: [{ id: "run_3", status: "Completed", updatedAt: new Date("2026-04-08T10:00:00Z") }],
      approvals: [],
      sync: { stale: true },
    });

    expect(result.persistedStatus).toBe("Completed");
    expect(result.displayState).toBe("Sync Stale");
  });
});

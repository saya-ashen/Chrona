import { describe, expect, it } from "bun:test";
import { deriveManagementWorkState, managementResultFinalization } from "./result-state";

function output(status: string, candidate = true, revision = 1) {
  return { manifest: { sourceRevision: 1 }, finalization: { status, sourceRevision: 1 },
    finalizedResult: candidate ? { sourceRevision: revision, spec: { root: "root", elements: { root: { type: "ResultOverview" } } } } : null };
}

describe("management result readiness", () => {
  it.each([
    ["Pending", false, 1, "result_pending", null],
    ["Running", false, 1, "finalizing", null],
    ["Running", true, 1, "finalizing", null],
    ["Failed", false, 1, "result_failed", "retry_result"],
    ["Ready", true, 1, "result_ready", "accept_result"],
    ["Ready", false, 1, "result_pending", null],
    ["Ready", true, 0, "result_pending", null],
  ] as const)("Completed + %s (candidate %s revision %s) -> %s", (status, candidate, revision, state, action) => {
    const finalization = managementResultFinalization(output(status, candidate, revision));
    const view = deriveManagementWorkState({ taskStatus: "Completed" }, finalization);
    expect(view.state).toBe(state);
    expect(view.primaryActionId).toBe(action);
    expect(finalization.canAccept).toBe(state === "result_ready");
    expect(view.canStop).toBe(false);
  });
  it.each([
    ["WaitingForInput", "waiting_for_input"], ["WaitingForApproval", "waiting_for_approval"],
    ["Blocked", "blocked"], ["Failed", "failed"], ["Cancelled", "cancelled"], ["Done", "done"],
  ] as const)("preserves %s independently of result presentation", (taskStatus, state) => {
    expect(deriveManagementWorkState({ taskStatus }, managementResultFinalization(output("Running"))).state).toBe(state);
  });
  it("does not invent acceptance readiness for a search row with no finalization evidence", () => {
    expect(deriveManagementWorkState({ taskStatus: "Completed" }).state).toBe("result_pending");
  });
});

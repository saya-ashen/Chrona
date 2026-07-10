import { describe, expect, it } from "bun:test";
import type { WorkStateCanonical, WorkStatePrimaryActionId } from "@chrona/domain";
import { stateViewForWorkspaceStatus } from "./task-workspace-state";

describe("workspace canonical work state", () => {
  const cases: Array<[string, WorkStateCanonical, string, WorkStatePrimaryActionId]> = [
    ["WaitingForInput", "waiting_for_input", "Input needed", "provide_input"],
    ["WaitingForApproval", "waiting_for_approval", "Approval needed", "review_approval"],
    ["Failed", "failed", "Failed", "retry"],
    ["Running", "running", "Running", "monitor_execution"],
  ];
  it.each(cases)("maps %s through the canonical view", (status, state, label, primaryActionId) => {
    const view = stateViewForWorkspaceStatus({ taskStatus: status });
    expect(view.state).toBe(state);
    expect(view.label).toBe(label);
    expect(view.primaryActionId).toBe(primaryActionId);
  });

  it("suppresses actions when a runnable state has a disabled reason", () => {
    const view = stateViewForWorkspaceStatus({
      planStatus: "accepted",
      hasAcceptedPlan: true,
      isRunnable: false,
      disabledReason: "Provider missing",
    });
    expect(view.state).toBe("ready_to_run");
    expect(view.primaryActionDisabledReason).toBe("Provider missing");
    expect(view.primaryActionId).toBeNull();
  });
});
